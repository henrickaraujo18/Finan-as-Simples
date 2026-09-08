use std::{fs, path::PathBuf, sync::Mutex};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State};
use uuid::Uuid;

struct LocalDb {
    connection: Mutex<Connection>,
    path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    platform: String,
    storage: String,
    offline_ready: bool,
    sync_queue_enabled: bool,
    database_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntityRow {
    id: String,
    entity_type: String,
    data: Value,
    version: i64,
    sync_state: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntityInput {
    entity_type: String,
    id: Option<String>,
    data: Value,
}

fn validate_entity_type(entity_type: &str) -> Result<(), String> {
    let allowed = [
        "transactions",
        "accounts",
        "categories",
        "customers",
        "suppliers",
        "quotes",
        "products",
        "inventory",
        "employees",
        "settings",
        "goals",
        "notes",
    ];

    if allowed.contains(&entity_type) {
        Ok(())
    } else {
        Err(format!("tipo de registro não permitido: {entity_type}"))
    }
}

fn configure_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;

             CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                data_json TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                sync_state TEXT NOT NULL DEFAULT 'pending',
                deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );

             CREATE INDEX IF NOT EXISTS idx_entities_type_updated
               ON entities(entity_type, deleted, updated_at DESC);

             CREATE TABLE IF NOT EXISTS sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );

             CREATE INDEX IF NOT EXISTS idx_sync_queue_status
               ON sync_queue(status, created_at);

             CREATE TABLE IF NOT EXISTS service_cache (
                cache_key TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                expires_at TEXT,
                updated_at TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );

             INSERT OR REPLACE INTO app_metadata(key, value)
             VALUES ('schema_version', '2');",
        )
        .map_err(|error| format!("falha ao configurar banco local: {error}"))?;

    Ok(())
}

fn entity_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntityRow> {
    let data_json: String = row.get(2)?;
    let data = serde_json::from_str(&data_json).unwrap_or(Value::Null);
    Ok(EntityRow {
        id: row.get(0)?,
        entity_type: row.get(1)?,
        data,
        version: row.get(3)?,
        sync_state: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[tauri::command]
fn runtime_status(db: State<'_, LocalDb>) -> RuntimeStatus {
    RuntimeStatus {
        platform: "desktop".to_string(),
        storage: "SQLite local (WAL)".to_string(),
        offline_ready: true,
        sync_queue_enabled: true,
        database_path: db.path.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn list_entities(db: State<'_, LocalDb>, entity_type: String) -> Result<Vec<EntityRow>, String> {
    validate_entity_type(&entity_type)?;
    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;

    let mut statement = connection
        .prepare(
            "SELECT id, entity_type, data_json, version, sync_state, created_at, updated_at
             FROM entities
             WHERE entity_type = ?1 AND deleted = 0
             ORDER BY updated_at DESC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![entity_type], entity_from_row)
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_entity(db: State<'_, LocalDb>, input: EntityInput) -> Result<EntityRow, String> {
    validate_entity_type(&input.entity_type)?;
    if !input.data.is_object() {
        return Err("o conteúdo do registro precisa ser um objeto JSON".to_string());
    }

    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let payload = serde_json::to_string(&input.data)
        .map_err(|error| format!("falha ao serializar registro: {error}"))?;

    let mut connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;

    let existing: Option<(i64, String)> = transaction
        .query_row(
            "SELECT version, created_at FROM entities WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let version = existing.as_ref().map(|(value, _)| value + 1).unwrap_or(1);
    let created_at = existing
        .map(|(_, value)| value)
        .unwrap_or_else(|| now.clone());

    transaction
        .execute(
            "INSERT INTO entities
             (id, entity_type, data_json, version, sync_state, deleted, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', 0, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               entity_type = excluded.entity_type,
               data_json = excluded.data_json,
               version = excluded.version,
               sync_state = 'pending',
               deleted = 0,
               updated_at = excluded.updated_at",
            params![id, input.entity_type, payload, version, created_at, now],
        )
        .map_err(|error| format!("falha ao salvar registro: {error}"))?;

    transaction
        .execute(
            "INSERT INTO sync_queue
             (entity_type, entity_id, operation, payload_json, version, status, created_at, updated_at)
             VALUES (?1, ?2, 'upsert', ?3, ?4, 'pending', ?5, ?5)",
            params![input.entity_type, id, payload, version, now],
        )
        .map_err(|error| format!("falha ao registrar sincronização: {error}"))?;

    transaction.commit().map_err(|error| error.to_string())?;

    connection
        .query_row(
            "SELECT id, entity_type, data_json, version, sync_state, created_at, updated_at
             FROM entities WHERE id = ?1",
            params![id],
            entity_from_row,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_entity(
    db: State<'_, LocalDb>,
    entity_type: String,
    id: String,
) -> Result<(), String> {
    validate_entity_type(&entity_type)?;
    let now = Utc::now().to_rfc3339();
    let mut connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;

    let current_version: i64 = transaction
        .query_row(
            "SELECT version FROM entities WHERE id = ?1 AND entity_type = ?2",
            params![id, entity_type],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "registro não encontrado".to_string())?;
    let version = current_version + 1;

    transaction
        .execute(
            "UPDATE entities
             SET deleted = 1, version = ?1, sync_state = 'pending', updated_at = ?2
             WHERE id = ?3 AND entity_type = ?4",
            params![version, now, id, entity_type],
        )
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "INSERT INTO sync_queue
             (entity_type, entity_id, operation, payload_json, version, status, created_at, updated_at)
             VALUES (?1, ?2, 'delete', '{}', ?3, 'pending', ?4, ?4)",
            params![entity_type, id, version, now],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn pending_sync_count(db: State<'_, LocalDb>) -> Result<i64, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    connection
        .query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn export_snapshot(db: State<'_, LocalDb>) -> Result<Value, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, entity_type, data_json, version, sync_state, created_at, updated_at
             FROM entities WHERE deleted = 0 ORDER BY entity_type, updated_at",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], entity_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "schemaVersion": 2,
        "generatedAt": Utc::now().to_rfc3339(),
        "entities": rows
    }))
}

#[tauri::command]
fn create_backup(db: State<'_, LocalDb>) -> Result<String, String> {
    {
        let connection = db
            .connection
            .lock()
            .map_err(|_| "banco local indisponível".to_string())?;
        connection
            .execute_batch("PRAGMA wal_checkpoint(FULL);")
            .map_err(|error| format!("falha ao consolidar banco: {error}"))?;
    }

    let parent = db
        .path
        .parent()
        .ok_or_else(|| "pasta de dados inválida".to_string())?;
    let backup_dir = parent.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("falha ao criar pasta de backup: {error}"))?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let destination = backup_dir.join(format!("financa-simples-{stamp}.sqlite3"));
    fs::copy(&db.path, &destination)
        .map_err(|error| format!("falha ao criar backup: {error}"))?;
    Ok(destination.to_string_lossy().to_string())
}

fn build_local_db(app: &tauri::App) -> Result<LocalDb, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("não foi possível localizar a pasta de dados: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("não foi possível criar a pasta de dados: {error}"))?;

    let database_path = app_data_dir.join("financa-simples.sqlite3");
    let connection = Connection::open(&database_path)
        .map_err(|error| format!("não foi possível abrir o banco local: {error}"))?;
    configure_database(&connection)?;

    Ok(LocalDb {
        connection: Mutex::new(connection),
        path: database_path,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let local_db = build_local_db(app)
                .map_err(Box::<dyn std::error::Error>::from)?;
            app.manage(local_db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            list_entities,
            upsert_entity,
            delete_entity,
            pending_sync_count,
            export_snapshot,
            create_backup
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Financa Simples");
}
