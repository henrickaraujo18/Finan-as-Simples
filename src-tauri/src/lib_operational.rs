use std::{fs, path::PathBuf, sync::Mutex};

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, State};
use tauri_plugin_updater::UpdaterExt;
use uuid::Uuid;

mod cloud_runtime_v16;
#[cfg(target_os = "windows")]
mod security_v16;

const UPDATE_ENDPOINT: &str = "https://github.com/henrickaraujo18/Finan-as-Simples/releases/download/desktop-preview/latest.json";

pub(crate) struct LocalDb {
    pub(crate) connection: Mutex<Connection>,
    pub(crate) path: PathBuf,
}

#[derive(Default)]
pub(crate) struct AuthState {
    pub(crate) session: Mutex<AuthSession>,
}

#[derive(Debug, Default, Clone)]
pub(crate) struct AuthSession {
    pub(crate) user_id: Option<String>,
    pub(crate) active_workspace_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    platform: String,
    storage: String,
    offline_ready: bool,
    sync_queue_enabled: bool,
    database_path: String,
    database_healthy: bool,
    database_check: String,
    auth_required: bool,
    updater_configured: bool,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AuthUser {
    id: String,
    email: String,
    is_super_admin: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummary {
    id: String,
    name: String,
    role: String,
    permissions: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthStatus {
    setup_required: bool,
    authenticated: bool,
    user: Option<AuthUser>,
    workspaces: Vec<WorkspaceSummary>,
    active_workspace_id: Option<String>,
    permissions: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberSummary {
    user_id: String,
    email: String,
    role: String,
    permissions: Value,
    is_super_admin: bool,
    is_owner: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantUserInput {
    workspace_id: String,
    email: String,
    temp_password: Option<String>,
    role: String,
    permissions: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMemberInput {
    workspace_id: String,
    user_id: String,
    role: String,
    permissions: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PasswordResetResponse {
    accepted: bool,
    cloud_provider_required: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    configured: bool,
    available: bool,
    version: Option<String>,
    message: String,
}

fn updater_public_key() -> Option<String> {
    option_env!("FINANCA_UPDATER_PUBLIC_KEY")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_email(value: &str) -> String {
    value.trim().to_lowercase()
}

pub(crate) fn validate_email(value: &str) -> Result<String, String> {
    let email = normalize_email(value);
    if email.len() < 5
        || email.len() > 254
        || !email.contains('@')
        || email.starts_with('@')
        || email.ends_with('@')
    {
        return Err("informe um e-mail válido".to_string());
    }
    Ok(email)
}

pub(crate) fn validate_password(value: &str) -> Result<(), String> {
    if value.len() < 10 {
        return Err("a senha precisa ter pelo menos 10 caracteres".to_string());
    }
    if value.len() > 256 {
        return Err("a senha excede o limite permitido".to_string());
    }
    Ok(())
}

pub(crate) fn hash_password(password: &str) -> Result<String, String> {
    validate_password(password)?;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| format!("falha ao proteger a senha: {error}"))
}

fn verify_password(password: &str, encoded: &str) -> bool {
    let Ok(hash) = PasswordHash::new(encoded) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
}

pub(crate) fn full_permissions() -> Value {
    json!({
        "dashboard": {"view": true, "create": false, "edit": false, "delete": false},
        "transactions": {"view": true, "create": true, "edit": true, "delete": true},
        "accounts": {"view": true, "create": true, "edit": true, "delete": true},
        "analytics": {"view": true, "create": false, "edit": false, "delete": false},
        "openFinance": {"view": true, "create": true, "edit": true, "delete": true},
        "investments": {"view": true, "create": true, "edit": true, "delete": true},
        "exports": {"view": true, "create": true, "edit": false, "delete": false},
        "settings": {"view": true, "create": true, "edit": true, "delete": true},
        "users": {"view": true, "create": true, "edit": true, "delete": true}
    })
}

pub(crate) fn empty_permissions() -> Value {
    json!({
        "dashboard": {"view": false, "create": false, "edit": false, "delete": false},
        "transactions": {"view": false, "create": false, "edit": false, "delete": false},
        "accounts": {"view": false, "create": false, "edit": false, "delete": false},
        "analytics": {"view": false, "create": false, "edit": false, "delete": false},
        "openFinance": {"view": false, "create": false, "edit": false, "delete": false},
        "investments": {"view": false, "create": false, "edit": false, "delete": false},
        "exports": {"view": false, "create": false, "edit": false, "delete": false},
        "settings": {"view": false, "create": false, "edit": false, "delete": false},
        "users": {"view": false, "create": false, "edit": false, "delete": false}
    })
}

fn sanitize_permissions(input: &Value) -> Value {
    let mut result = empty_permissions();
    for module in [
        "dashboard",
        "transactions",
        "accounts",
        "analytics",
        "openFinance",
        "investments",
        "exports",
        "settings",
        "users",
    ] {
        for action in ["view", "create", "edit", "delete"] {
            let enabled = input
                .get(module)
                .and_then(|value| value.get(action))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            result[module][action] = Value::Bool(enabled);
        }
    }
    result
}

pub(crate) fn permission_allowed(permissions: &Value, module: &str, action: &str) -> bool {
    permissions
        .get(module)
        .and_then(|value| value.get(action))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn permissions_subset(requested: &Value, caller: &Value) -> bool {
    for module in [
        "dashboard",
        "transactions",
        "accounts",
        "analytics",
        "openFinance",
        "investments",
        "exports",
        "settings",
        "users",
    ] {
        for action in ["view", "create", "edit", "delete"] {
            if permission_allowed(requested, module, action)
                && !permission_allowed(caller, module, action)
            {
                return false;
            }
        }
    }
    true
}

fn validate_entity_type(entity_type: &str) -> Result<(), String> {
    let allowed = [
        "transactions",
        "accounts",
        "cards",
        "categories",
        "investments",
        "settings",
    ];
    if allowed.contains(&entity_type) {
        Ok(())
    } else {
        Err(format!("tipo de registro não permitido: {entity_type}"))
    }
}

pub(crate) fn entity_module(entity_type: &str) -> &'static str {
    match entity_type {
        "transactions" => "transactions",
        "accounts" | "cards" => "accounts",
        "investments" => "investments",
        "categories" | "settings" => "settings",
        _ => "settings",
    }
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    for name in names {
        if name.map_err(|error| error.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn configure_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;

             CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL DEFAULT '',
                entity_type TEXT NOT NULL,
                data_json TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                sync_state TEXT NOT NULL DEFAULT 'local',
                deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );

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

             CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_super_admin INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                owner_user_id TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(owner_user_id) REFERENCES users(id)
             );

             CREATE TABLE IF NOT EXISTS memberships (
                user_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                role TEXT NOT NULL,
                permissions_json TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(user_id, workspace_id),
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
             );

             CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                workspace_id TEXT,
                action TEXT NOT NULL,
                details_json TEXT NOT NULL,
                created_at TEXT NOT NULL
             );",
        )
        .map_err(|error| format!("falha ao configurar banco local: {error}"))?;

    if !table_has_column(connection, "entities", "workspace_id")? {
        connection
            .execute(
                "ALTER TABLE entities ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|error| format!("falha ao migrar isolamento por ambiente: {error}"))?;
    }

    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_entities_workspace_type_updated
               ON entities(workspace_id, entity_type, deleted, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_entities_workspace_sync
               ON entities(workspace_id, sync_state, updated_at);
             CREATE INDEX IF NOT EXISTS idx_memberships_workspace
               ON memberships(workspace_id, active, user_id);
             CREATE INDEX IF NOT EXISTS idx_audit_workspace_created
               ON audit_log(workspace_id, created_at DESC);

             INSERT OR REPLACE INTO app_metadata(key, value)
             VALUES ('schema_version', '6');
             INSERT OR REPLACE INTO app_metadata(key, value)
             VALUES ('product_scope', 'financa-simples');
             INSERT OR REPLACE INTO app_metadata(key, value)
             VALUES ('storage_security', 'sqlcipher-dpapi');",
        )
        .map_err(|error| format!("falha ao finalizar migração local: {error}"))?;
    Ok(())
}

fn entity_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntityRow> {
    let data_json: String = row.get(2)?;
    Ok(EntityRow {
        id: row.get(0)?,
        entity_type: row.get(1)?,
        data: serde_json::from_str(&data_json).unwrap_or(Value::Null),
        version: row.get(3)?,
        sync_state: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub(crate) fn audit(
    connection: &Connection,
    user_id: Option<&str>,
    workspace_id: Option<&str>,
    action: &str,
    details: Value,
) {
    let _ = connection.execute(
        "INSERT INTO audit_log(id,user_id,workspace_id,action,details_json,created_at)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            Uuid::new_v4().to_string(),
            user_id,
            workspace_id,
            action,
            details.to_string(),
            Utc::now().to_rfc3339()
        ],
    );
}

fn workspace_permissions(
    connection: &Connection,
    user_id: &str,
    workspace_id: &str,
) -> Result<Value, String> {
    let raw: String = connection
        .query_row(
            "SELECT permissions_json FROM memberships
             WHERE user_id=?1 AND workspace_id=?2 AND active=1",
            params![user_id, workspace_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "acesso a este ambiente não autorizado".to_string())?;
    Ok(serde_json::from_str(&raw).unwrap_or_else(|_| empty_permissions()))
}

fn workspace_role(
    connection: &Connection,
    user_id: &str,
    workspace_id: &str,
) -> Result<String, String> {
    connection
        .query_row(
            "SELECT role FROM memberships WHERE user_id=?1 AND workspace_id=?2 AND active=1",
            params![user_id, workspace_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "acesso a este ambiente não autorizado".to_string())
}

fn require_context(db: &LocalDb, auth: &AuthState) -> Result<(String, String, Value, bool), String> {
    let session = auth
        .session
        .lock()
        .map_err(|_| "sessão indisponível".to_string())?
        .clone();
    let user_id = session
        .user_id
        .ok_or_else(|| "autenticação necessária".to_string())?;
    let workspace_id = session
        .active_workspace_id
        .ok_or_else(|| "nenhum ambiente financeiro selecionado".to_string())?;
    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let is_super_admin = connection
        .query_row(
            "SELECT is_super_admin FROM users WHERE id=?1 AND active=1",
            params![user_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(|value| value != 0)
        .ok_or_else(|| "usuário não encontrado ou inativo".to_string())?;
    let permissions = workspace_permissions(&connection, &user_id, &workspace_id)?;
    Ok((user_id, workspace_id, permissions, is_super_admin))
}

fn can_read_entity(entity_type: &str, permissions: &Value) -> bool {
    if matches!(entity_type, "categories" | "settings") {
        return true;
    }
    permission_allowed(permissions, entity_module(entity_type), "view")
}

fn require_entity_action(
    entity_type: &str,
    permissions: &Value,
    action: &str,
) -> Result<(), String> {
    let module = entity_module(entity_type);
    if permission_allowed(permissions, module, action) {
        Ok(())
    } else {
        Err(format!("sem permissão para {action} no módulo {module}"))
    }
}

fn upsert_in_transaction(
    transaction: &Transaction<'_>,
    input: EntityInput,
    workspace_id: &str,
) -> Result<String, String> {
    validate_entity_type(&input.entity_type)?;
    if !input.data.is_object() {
        return Err("o conteúdo do registro precisa ser um objeto JSON".to_string());
    }

    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let payload = serde_json::to_string(&input.data)
        .map_err(|error| format!("falha ao serializar registro: {error}"))?;
    let existing: Option<(i64, String, String)> = transaction
        .query_row(
            "SELECT version,created_at,workspace_id FROM entities WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some((_, _, existing_workspace)) = &existing {
        if existing_workspace != workspace_id {
            return Err("registro pertence a outro ambiente financeiro".to_string());
        }
    }
    let version = existing.as_ref().map(|row| row.0 + 1).unwrap_or(1);
    let created_at = existing
        .map(|row| row.1)
        .unwrap_or_else(|| now.clone());

    transaction
        .execute(
            "INSERT INTO entities(id,workspace_id,entity_type,data_json,version,sync_state,deleted,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,'local',0,?6,?7)
             ON CONFLICT(id) DO UPDATE SET
               entity_type=excluded.entity_type,
               data_json=excluded.data_json,
               version=excluded.version,
               sync_state='local',
               deleted=0,
               updated_at=excluded.updated_at",
            params![
                id,
                workspace_id,
                input.entity_type,
                payload,
                version,
                created_at,
                now
            ],
        )
        .map_err(|error| format!("falha ao salvar registro: {error}"))?;
    Ok(id)
}

pub(crate) fn auth_status_internal(
    connection: &Connection,
    session: &AuthSession,
) -> Result<AuthStatus, String> {
    let user_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM users WHERE active=1", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if user_count == 0 {
        return Ok(AuthStatus {
            setup_required: true,
            authenticated: false,
            user: None,
            workspaces: vec![],
            active_workspace_id: None,
            permissions: empty_permissions(),
        });
    }

    let Some(user_id) = session.user_id.as_deref() else {
        return Ok(AuthStatus {
            setup_required: false,
            authenticated: false,
            user: None,
            workspaces: vec![],
            active_workspace_id: None,
            permissions: empty_permissions(),
        });
    };

    let user = connection
        .query_row(
            "SELECT id,email,is_super_admin FROM users WHERE id=?1 AND active=1",
            params![user_id],
            |row| {
                Ok(AuthUser {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    is_super_admin: row.get::<_, i64>(2)? != 0,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(user) = user else {
        return Ok(AuthStatus {
            setup_required: false,
            authenticated: false,
            user: None,
            workspaces: vec![],
            active_workspace_id: None,
            permissions: empty_permissions(),
        });
    };

    let mut statement = connection
        .prepare(
            "SELECT w.id,w.name,m.role,m.permissions_json
             FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
             WHERE m.user_id=?1 AND m.active=1 AND w.active=1
             ORDER BY w.created_at,w.name",
        )
        .map_err(|error| error.to_string())?;
    let workspaces = statement
        .query_map(params![user.id], |row| {
            let permissions_raw: String = row.get(3)?;
            Ok(WorkspaceSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                role: row.get(2)?,
                permissions: serde_json::from_str(&permissions_raw)
                    .unwrap_or_else(|_| empty_permissions()),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let active_workspace_id = session
        .active_workspace_id
        .clone()
        .filter(|id| workspaces.iter().any(|workspace| &workspace.id == id))
        .or_else(|| workspaces.first().map(|workspace| workspace.id.clone()));
    let permissions = active_workspace_id
        .as_ref()
        .and_then(|id| workspaces.iter().find(|workspace| &workspace.id == id))
        .map(|workspace| workspace.permissions.clone())
        .unwrap_or_else(empty_permissions);

    Ok(AuthStatus {
        setup_required: false,
        authenticated: true,
        user: Some(user),
        workspaces,
        active_workspace_id,
        permissions,
    })
}

#[tauri::command]
fn runtime_status(db: State<'_, LocalDb>) -> RuntimeStatus {
    let (database_healthy, database_check) = match db.connection.lock() {
        Ok(connection) => {
            let check = connection
                .query_row("PRAGMA quick_check;", [], |row| row.get::<_, String>(0))
                .unwrap_or_else(|error| format!("erro: {error}"));
            (check.eq_ignore_ascii_case("ok"), check)
        }
        Err(_) => (false, "não foi possível acessar o banco local".to_string()),
    };
    RuntimeStatus {
        platform: "desktop".to_string(),
        storage: "SQLCipher AES-256 / chave protegida pelo Windows".to_string(),
        offline_ready: true,
        sync_queue_enabled: true,
        database_path: db.path.to_string_lossy().to_string(),
        database_healthy,
        database_check,
        auth_required: true,
        updater_configured: updater_public_key().is_some(),
    }
}

#[tauri::command]
fn auth_status(db: State<'_, LocalDb>, auth: State<'_, AuthState>) -> Result<AuthStatus, String> {
    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let mut session = auth
        .session
        .lock()
        .map_err(|_| "sessão indisponível".to_string())?;
    let status = auth_status_internal(&connection, &session)?;
    if status.authenticated && session.active_workspace_id.is_none() {
        session.active_workspace_id = status.active_workspace_id.clone();
    }
    Ok(status)
}

#[tauri::command]
fn auth_setup_owner(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    email: String,
    password: String,
    workspace_name: String,
) -> Result<AuthStatus, String> {
    let email = validate_email(&email)?;
    let password_hash = hash_password(&password)?;
    let user_id = Uuid::new_v4().to_string();
    let workspace_id = Uuid::new_v4().to_string();
    let name = if workspace_name.trim().is_empty() {
        "Meu Financeiro".to_string()
    } else {
        workspace_name.trim().to_string()
    };
    let now = Utc::now().to_rfc3339();
    let permissions = full_permissions();
    let mut connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let existing: i64 = connection
        .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if existing > 0 {
        return Err("a conta local já foi configurada".to_string());
    }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO users(id,email,password_hash,is_super_admin,active,created_at,updated_at)
             VALUES (?1,?2,?3,1,1,?4,?4)",
            params![user_id, email, password_hash, now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO workspaces(id,name,owner_user_id,active,created_at,updated_at)
             VALUES (?1,?2,?3,1,?4,?4)",
            params![workspace_id, name, user_id, now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO memberships(user_id,workspace_id,role,permissions_json,active,created_at,updated_at)
             VALUES (?1,?2,'owner',?3,1,?4,?4)",
            params![user_id, workspace_id, permissions.to_string(), now],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE entities SET workspace_id=?1,sync_state='local' WHERE workspace_id=''",
            params![workspace_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    audit(
        &connection,
        Some(&user_id),
        Some(&workspace_id),
        "owner_setup",
        json!({"email": email}),
    );
    drop(connection);
    {
        let mut session = auth
            .session
            .lock()
            .map_err(|_| "sessão indisponível".to_string())?;
        session.user_id = Some(user_id);
        session.active_workspace_id = Some(workspace_id);
    }
    auth_status(db, auth)
}

#[tauri::command]
fn auth_login(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    email: String,
    password: String,
) -> Result<AuthStatus, String> {
    let email = validate_email(&email)?;
    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let user = connection
        .query_row(
            "SELECT id,password_hash FROM users WHERE email=?1 AND active=1",
            params![email],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((user_id, password_hash)) = user else {
        return Err("e-mail ou senha inválidos".to_string());
    };
    if !verify_password(&password, &password_hash) {
        audit(&connection, None, None, "login_failed", json!({"email": email}));
        return Err("e-mail ou senha inválidos".to_string());
    }
    let workspace_id: Option<String> = connection
        .query_row(
            "SELECT workspace_id FROM memberships WHERE user_id=?1 AND active=1 ORDER BY created_at LIMIT 1",
            params![user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    audit(
        &connection,
        Some(&user_id),
        workspace_id.as_deref(),
        "login",
        json!({}),
    );
    drop(connection);
    {
        let mut session = auth
            .session
            .lock()
            .map_err(|_| "sessão indisponível".to_string())?;
        session.user_id = Some(user_id);
        session.active_workspace_id = workspace_id;
    }
    auth_status(db, auth)
}

#[tauri::command]
fn auth_logout(auth: State<'_, AuthState>) -> Result<(), String> {
    let mut session = auth
        .session
        .lock()
        .map_err(|_| "sessão indisponível".to_string())?;
    *session = AuthSession::default();
    Ok(())
}

#[tauri::command]
fn auth_switch_workspace(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    workspace_id: String,
) -> Result<AuthStatus, String> {
    let snapshot = auth
        .session
        .lock()
        .map_err(|_| "sessão indisponível".to_string())?
        .clone();
    let user_id = snapshot
        .user_id
        .ok_or_else(|| "autenticação necessária".to_string())?;
    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    let _ = workspace_permissions(&connection, &user_id, &workspace_id)?;
    audit(
        &connection,
        Some(&user_id),
        Some(&workspace_id),
        "workspace_switch",
        json!({}),
    );
    drop(connection);
    auth.session
        .lock()
        .map_err(|_| "sessão indisponível".to_string())?
        .active_workspace_id = Some(workspace_id);
    auth_status(db, auth)
}

#[tauri::command]
fn auth_create_workspace(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    name: String,
) -> Result<AuthStatus, String> {
    let (user_id, current_workspace, permissions, is_super_admin) = require_context(&db, &auth)?;
    let role = {
        let connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
        workspace_role(&connection, &user_id, &current_workspace)?
    };
    if !is_super_admin
        && role != "owner"
        && !permission_allowed(&permissions, "users", "create")
    {
        return Err("sem permissão para criar um novo ambiente".to_string());
    }
    let workspace_name = name.trim();
    if workspace_name.len() < 2 || workspace_name.len() > 120 {
        return Err("informe um nome de ambiente válido".to_string());
    }
    let workspace_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let full = full_permissions();
    let mut connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO workspaces(id,name,owner_user_id,active,created_at,updated_at) VALUES (?1,?2,?3,1,?4,?4)",
        params![workspace_id, workspace_name, user_id, now]
    ).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO memberships(user_id,workspace_id,role,permissions_json,active,created_at,updated_at) VALUES (?1,?2,'owner',?3,1,?4,?4)",
        params![user_id, workspace_id, full.to_string(), now]
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    audit(&connection, Some(&user_id), Some(&workspace_id), "workspace_create", json!({"name":workspace_name}));
    drop(connection);
    auth.session.lock().map_err(|_| "sessão indisponível".to_string())?.active_workspace_id = Some(workspace_id);
    auth_status(db, auth)
}

fn require_user_admin(
    connection: &Connection,
    user_id: &str,
    workspace_id: &str,
    is_super_admin: bool,
    action: &str,
) -> Result<(), String> {
    if is_super_admin || workspace_role(connection, user_id, workspace_id)? == "owner" {
        return Ok(());
    }
    let permissions = workspace_permissions(connection, user_id, workspace_id)?;
    if permission_allowed(&permissions, "users", action) {
        Ok(())
    } else {
        Err("sem permissão para administrar usuários neste ambiente".to_string())
    }
}

#[tauri::command]
fn auth_list_members(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    workspace_id: String,
) -> Result<Vec<MemberSummary>, String> {
    let (caller_id, _, _, is_super_admin) = require_context(&db, &auth)?;
    let connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    require_user_admin(&connection, &caller_id, &workspace_id, is_super_admin, "view")?;
    let owner_id: String = connection.query_row(
        "SELECT owner_user_id FROM workspaces WHERE id=?1", params![workspace_id], |row| row.get(0)
    ).map_err(|error| error.to_string())?;
    let mut statement = connection.prepare(
        "SELECT u.id,u.email,m.role,m.permissions_json,u.is_super_admin
         FROM memberships m JOIN users u ON u.id=m.user_id
         WHERE m.workspace_id=?1 AND m.active=1 AND u.active=1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.email"
    ).map_err(|error| error.to_string())?;
    statement.query_map(params![workspace_id], |row| {
        let user_id: String = row.get(0)?;
        let raw: String = row.get(3)?;
        Ok(MemberSummary {
            is_owner: user_id == owner_id,
            user_id,
            email: row.get(1)?,
            role: row.get(2)?,
            permissions: serde_json::from_str(&raw).unwrap_or_else(|_| empty_permissions()),
            is_super_admin: row.get::<_,i64>(4)? != 0,
        })
    }).map_err(|error| error.to_string())?
      .collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn auth_create_or_grant_user(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    input: GrantUserInput,
) -> Result<Vec<MemberSummary>, String> {
    let (caller_id, _, caller_permissions, is_super_admin) = require_context(&db, &auth)?;
    let email = validate_email(&input.email)?;
    let permissions = sanitize_permissions(&input.permissions);
    let role = match input.role.as_str() {
        "admin" | "operator" | "viewer" | "custom" => input.role,
        _ => "custom".to_string(),
    };
    let now = Utc::now().to_rfc3339();
    let mut connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    require_user_admin(&connection, &caller_id, &input.workspace_id, is_super_admin, "create")?;
    let caller_role = workspace_role(&connection, &caller_id, &input.workspace_id)?;
    if !is_super_admin && caller_role != "owner" && !permissions_subset(&permissions, &caller_permissions) {
        return Err("não é permitido conceder permissões superiores às suas".to_string());
    }
    let existing_user: Option<String> = connection.query_row(
        "SELECT id FROM users WHERE email=?1", params![email], |row| row.get(0)
    ).optional().map_err(|error| error.to_string())?;
    let user_id = if let Some(id) = existing_user { id } else {
        let password = input.temp_password.as_deref().ok_or_else(|| "para novo usuário offline, informe uma senha inicial".to_string())?;
        let password_hash = hash_password(password)?;
        let id = Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO users(id,email,password_hash,is_super_admin,active,created_at,updated_at) VALUES (?1,?2,?3,0,1,?4,?4)",
            params![id,email,password_hash,now]
        ).map_err(|error| error.to_string())?;
        id
    };
    connection.execute(
        "INSERT INTO memberships(user_id,workspace_id,role,permissions_json,active,created_at,updated_at)
         VALUES (?1,?2,?3,?4,1,?5,?5)
         ON CONFLICT(user_id,workspace_id) DO UPDATE SET role=excluded.role,permissions_json=excluded.permissions_json,active=1,updated_at=excluded.updated_at",
        params![user_id,input.workspace_id,role,permissions.to_string(),now]
    ).map_err(|error| error.to_string())?;
    audit(&connection, Some(&caller_id), Some(&input.workspace_id), "member_grant", json!({"targetUserId":user_id,"email":email,"role":role}));
    drop(connection);
    auth_list_members(db, auth, input.workspace_id)
}

#[tauri::command]
fn auth_update_member_permissions(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    input: UpdateMemberInput,
) -> Result<Vec<MemberSummary>, String> {
    let (caller_id, _, caller_permissions, is_super_admin) = require_context(&db, &auth)?;
    let permissions = sanitize_permissions(&input.permissions);
    let role = match input.role.as_str() {
        "admin" | "operator" | "viewer" | "custom" => input.role,
        _ => "custom".to_string(),
    };
    let connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    require_user_admin(&connection, &caller_id, &input.workspace_id, is_super_admin, "edit")?;
    let owner_id: String = connection.query_row(
        "SELECT owner_user_id FROM workspaces WHERE id=?1", params![input.workspace_id], |row| row.get(0)
    ).map_err(|error| error.to_string())?;
    if input.user_id == owner_id { return Err("as permissões do proprietário não podem ser reduzidas".to_string()); }
    let caller_role = workspace_role(&connection, &caller_id, &input.workspace_id)?;
    if !is_super_admin && caller_role != "owner" && !permissions_subset(&permissions, &caller_permissions) {
        return Err("não é permitido conceder permissões superiores às suas".to_string());
    }
    connection.execute(
        "UPDATE memberships SET role=?1,permissions_json=?2,updated_at=?3 WHERE user_id=?4 AND workspace_id=?5 AND active=1",
        params![role,permissions.to_string(),Utc::now().to_rfc3339(),input.user_id,input.workspace_id]
    ).map_err(|error| error.to_string())?;
    audit(&connection, Some(&caller_id), Some(&input.workspace_id), "member_permissions_update", json!({"targetUserId":input.user_id,"role":role}));
    drop(connection);
    auth_list_members(db, auth, input.workspace_id)
}

#[tauri::command]
fn auth_remove_member(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    workspace_id: String,
    user_id: String,
) -> Result<Vec<MemberSummary>, String> {
    let (caller_id, _, _, is_super_admin) = require_context(&db, &auth)?;
    if caller_id == user_id { return Err("não é possível remover o próprio acesso por esta tela".to_string()); }
    let connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    require_user_admin(&connection, &caller_id, &workspace_id, is_super_admin, "delete")?;
    let owner_id: String = connection.query_row(
        "SELECT owner_user_id FROM workspaces WHERE id=?1", params![workspace_id], |row| row.get(0)
    ).map_err(|error| error.to_string())?;
    if user_id == owner_id { return Err("o proprietário do ambiente não pode ser removido".to_string()); }
    connection.execute(
        "UPDATE memberships SET active=0,updated_at=?1 WHERE user_id=?2 AND workspace_id=?3",
        params![Utc::now().to_rfc3339(),user_id,workspace_id]
    ).map_err(|error| error.to_string())?;
    audit(&connection, Some(&caller_id), Some(&workspace_id), "member_remove", json!({"targetUserId":user_id}));
    drop(connection);
    auth_list_members(db, auth, workspace_id)
}

#[tauri::command]
fn auth_change_password(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let (user_id, workspace_id, _, _) = require_context(&db, &auth)?;
    let new_hash = hash_password(&new_password)?;
    let connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    let old_hash: String = connection.query_row(
        "SELECT password_hash FROM users WHERE id=?1", params![user_id], |row| row.get(0)
    ).map_err(|error| error.to_string())?;
    if !verify_password(&current_password,&old_hash) { return Err("senha atual inválida".to_string()); }
    connection.execute(
        "UPDATE users SET password_hash=?1,updated_at=?2 WHERE id=?3",
        params![new_hash,Utc::now().to_rfc3339(),user_id]
    ).map_err(|error| error.to_string())?;
    audit(&connection, Some(&user_id), Some(&workspace_id), "password_change", json!({}));
    Ok(())
}

#[tauri::command]
fn auth_request_password_reset(email: String) -> Result<PasswordResetResponse, String> {
    let _ = validate_email(&email)?;
    Ok(PasswordResetResponse {
        accepted: true,
        cloud_provider_required: false,
        message: "Se existir uma conta vinculada a este e-mail, as instruções de recuperação serão enviadas.".to_string(),
    })
}

#[tauri::command]
fn list_entities(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    entity_type: String,
) -> Result<Vec<EntityRow>, String> {
    validate_entity_type(&entity_type)?;
    let (_, workspace_id, permissions, _) = require_context(&db,&auth)?;
    if !can_read_entity(&entity_type,&permissions) { return Ok(vec![]); }
    let connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    let mut statement = connection.prepare(
        "SELECT id,entity_type,data_json,version,sync_state,created_at,updated_at
         FROM entities WHERE workspace_id=?1 AND entity_type=?2 AND deleted=0 ORDER BY updated_at DESC"
    ).map_err(|error| error.to_string())?;
    statement.query_map(params![workspace_id,entity_type], entity_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_entity(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    input: EntityInput,
) -> Result<EntityRow, String> {
    let (user_id,workspace_id,permissions,_) = require_context(&db,&auth)?;
    validate_entity_type(&input.entity_type)?;
    require_entity_action(&input.entity_type,&permissions,if input.id.is_some(){"edit"}else{"create"})?;
    let entity_type = input.entity_type.clone();
    let mut connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let id = upsert_in_transaction(&transaction,input,&workspace_id)?;
    transaction.commit().map_err(|error| error.to_string())?;
    audit(&connection,Some(&user_id),Some(&workspace_id),"entity_upsert",json!({"entityType":entity_type,"id":id}));
    connection.query_row(
        "SELECT id,entity_type,data_json,version,sync_state,created_at,updated_at FROM entities WHERE id=?1 AND workspace_id=?2",
        params![id,workspace_id],entity_from_row
    ).map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_entities(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    inputs: Vec<EntityInput>,
) -> Result<Vec<EntityRow>, String> {
    if inputs.is_empty(){return Ok(vec![]);}
    let (user_id,workspace_id,permissions,_) = require_context(&db,&auth)?;
    for input in &inputs {
        validate_entity_type(&input.entity_type)?;
        require_entity_action(&input.entity_type,&permissions,if input.id.is_some(){"edit"}else{"create"})?;
    }
    let mut connection = db.connection.lock().map_err(|_| "banco local indisponível".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let mut ids=Vec::with_capacity(inputs.len());
    for input in inputs { ids.push(upsert_in_transaction(&transaction,input,&workspace_id)?); }
    transaction.commit().map_err(|error| error.to_string())?;
    audit(&connection,Some(&user_id),Some(&workspace_id),"entities_bulk_upsert",json!({"count":ids.len()}));
    let mut rows=Vec::with_capacity(ids.len());
    for id in ids {
        rows.push(connection.query_row(
            "SELECT id,entity_type,data_json,version,sync_state,created_at,updated_at FROM entities WHERE id=?1 AND workspace_id=?2",
            params![id,workspace_id],entity_from_row
        ).map_err(|error| error.to_string())?);
    }
    Ok(rows)
}

#[tauri::command]
fn delete_entity(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    entity_type:String,
    id:String,
) -> Result<(),String> {
    validate_entity_type(&entity_type)?;
    let (user_id,workspace_id,permissions,_) = require_context(&db,&auth)?;
    require_entity_action(&entity_type,&permissions,"delete")?;
    let now=Utc::now().to_rfc3339();
    let mut connection=db.connection.lock().map_err(|_|"banco local indisponível".to_string())?;
    let transaction=connection.transaction().map_err(|error|error.to_string())?;
    let current_version:i64=transaction.query_row(
        "SELECT version FROM entities WHERE id=?1 AND workspace_id=?2 AND entity_type=?3",
        params![id,workspace_id,entity_type],|row|row.get(0)
    ).optional().map_err(|error|error.to_string())?.ok_or_else(||"registro não encontrado neste ambiente".to_string())?;
    transaction.execute(
        "UPDATE entities SET deleted=1,version=?1,sync_state='local',updated_at=?2 WHERE id=?3 AND workspace_id=?4 AND entity_type=?5",
        params![current_version+1,now,id,workspace_id,entity_type]
    ).map_err(|error|error.to_string())?;
    transaction.commit().map_err(|error|error.to_string())?;
    audit(&connection,Some(&user_id),Some(&workspace_id),"entity_delete",json!({"entityType":entity_type,"id":id}));
    Ok(())
}

#[tauri::command]
fn pending_sync_count(db: State<'_, LocalDb>, auth: State<'_, AuthState>) -> Result<i64,String> {
    let (_,workspace_id,_,_) = require_context(&db,&auth)?;
    let connection=db.connection.lock().map_err(|_|"banco local indisponível".to_string())?;
    connection.query_row(
        "SELECT COUNT(*) FROM entities WHERE workspace_id=?1 AND sync_state!='synced'",
        params![workspace_id],|row|row.get(0)
    ).map_err(|error|error.to_string())
}

#[tauri::command]
fn export_snapshot(db: State<'_, LocalDb>, auth: State<'_, AuthState>) -> Result<Value,String> {
    let (_,workspace_id,permissions,_) = require_context(&db,&auth)?;
    if !permission_allowed(&permissions,"exports","view") { return Err("sem permissão para exportar dados".to_string()); }
    let connection=db.connection.lock().map_err(|_|"banco local indisponível".to_string())?;
    let mut statement=connection.prepare(
        "SELECT id,entity_type,data_json,version,sync_state,created_at,updated_at FROM entities
         WHERE workspace_id=?1 AND deleted=0 AND entity_type IN ('transactions','accounts','cards','categories','investments','settings')
         ORDER BY entity_type,updated_at"
    ).map_err(|error|error.to_string())?;
    let rows=statement.query_map(params![workspace_id],entity_from_row).map_err(|error|error.to_string())?
        .collect::<Result<Vec<_>,_>>().map_err(|error|error.to_string())?;
    Ok(json!({"product":"Finança Simples","schemaVersion":6,"generatedAt":Utc::now().to_rfc3339(),"workspaceId":workspace_id,"entities":rows}))
}

fn create_backup_internal(db:&LocalDb)->Result<String,String>{
    let connection=db.connection.lock().map_err(|_|"banco local indisponível".to_string())?;
    #[cfg(target_os="windows")]
    { return security_v16::create_consistent_backup(&connection,&db.path); }
    #[cfg(not(target_os="windows"))]
    {
        let parent=db.path.parent().ok_or_else(||"pasta de dados inválida".to_string())?;
        let dir=parent.join("backups");
        fs::create_dir_all(&dir).map_err(|error|error.to_string())?;
        let destination=dir.join(format!("financa-simples-{}.sqlite3",Utc::now().format("%Y%m%d-%H%M%S")));
        let mut target=Connection::open(&destination).map_err(|error|error.to_string())?;
        let backup=rusqlite::backup::Backup::new(&connection,&mut target).map_err(|error|error.to_string())?;
        backup.run_to_completion(128,std::time::Duration::from_millis(10),None).map_err(|error|error.to_string())?;
        return Ok(destination.to_string_lossy().to_string());
    }
}

#[tauri::command]
fn create_backup(db:State<'_,LocalDb>,auth:State<'_,AuthState>)->Result<String,String>{
    let (user_id,workspace_id,permissions,is_super_admin)=require_context(&db,&auth)?;
    let role={let connection=db.connection.lock().map_err(|_|"banco local indisponível".to_string())?;workspace_role(&connection,&user_id,&workspace_id)?};
    if !is_super_admin && role!="owner" && !permission_allowed(&permissions,"exports","create"){
        return Err("sem permissão para criar backup".to_string());
    }
    create_backup_internal(&db)
}

#[tauri::command]
async fn check_and_install_update(app:tauri::AppHandle,db:State<'_,LocalDb>)->Result<UpdateResult,String>{
    let Some(pubkey)=updater_public_key() else {
        return Ok(UpdateResult{configured:false,available:false,version:None,message:"atualização automática aguardando assinatura de produção".to_string()});
    };
    let endpoint=UPDATE_ENDPOINT.parse().map_err(|error|format!("endpoint de atualização inválido: {error}"))?;
    let updater=app.updater_builder().pubkey(pubkey).endpoints(vec![endpoint])
        .map_err(|error|format!("falha ao configurar atualizador: {error}"))?.build()
        .map_err(|error|format!("falha ao iniciar atualizador: {error}"))?;
    let Some(update)=updater.check().await.map_err(|error|format!("falha ao verificar atualização: {error}"))? else {
        return Ok(UpdateResult{configured:true,available:false,version:None,message:"Finança Simples está atualizado".to_string()});
    };
    let version=update.version.clone();
    create_backup_internal(&db)?;
    update.download_and_install(|_,_|{},||{}).await.map_err(|error|format!("falha ao instalar atualização {version}: {error}"))?;
    app.restart();
}

fn build_local_db(app:&tauri::App)->Result<LocalDb,String>{
    let app_data_dir=app.path().app_data_dir().map_err(|error|format!("não foi possível localizar a pasta de dados: {error}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|error|format!("não foi possível criar a pasta de dados: {error}"))?;
    let database_path=app_data_dir.join("financa-simples.sqlite3");
    #[cfg(target_os="windows")]
    let connection=security_v16::open_secure_database(&database_path)?;
    #[cfg(not(target_os="windows"))]
    let connection=Connection::open(&database_path).map_err(|error|format!("não foi possível abrir o banco local: {error}"))?;
    configure_database(&connection)?;
    Ok(LocalDb{connection:Mutex::new(connection),path:database_path})
}

#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default()
        .setup(|app|{
            let local_db=build_local_db(app).map_err(Box::<dyn std::error::Error>::from)?;
            app.manage(local_db);
            app.manage(AuthState::default());
            if let Some(pubkey)=updater_public_key(){
                app.handle().plugin(tauri_plugin_updater::Builder::new().pubkey(pubkey).build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_status,auth_status,auth_setup_owner,auth_login,auth_logout,auth_switch_workspace,
            auth_create_workspace,auth_list_members,auth_create_or_grant_user,auth_update_member_permissions,
            auth_remove_member,auth_change_password,auth_request_password_reset,list_entities,upsert_entity,
            upsert_entities,delete_entity,pending_sync_count,export_snapshot,create_backup,check_and_install_update,
            cloud_runtime_v16::cloud_reconcile_login,cloud_runtime_v16::cloud_ensure_workspace,cloud_runtime_v16::cloud_sync
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Financa Simples");
}

#[cfg(test)]
mod tests{
    use super::*;

    #[test]
    fn escopo_aceita_apenas_entidades_financeiras(){
        for entity_type in ["transactions","accounts","cards","categories","investments","settings"]{assert!(validate_entity_type(entity_type).is_ok());}
        for entity_type in ["products","inventory","employees","quotes","customers","suppliers"]{assert!(validate_entity_type(entity_type).is_err());}
    }

    #[test]
    fn banco_local_configura_schema_seis(){
        let connection=Connection::open_in_memory().expect("sqlite em memória");
        configure_database(&connection).expect("configurar banco");
        let version:String=connection.query_row("SELECT value FROM app_metadata WHERE key='schema_version'",[],|row|row.get(0)).unwrap();
        assert_eq!(version,"6");
        assert!(table_has_column(&connection,"entities","workspace_id").unwrap());
    }

    #[test]
    fn senha_argon2_nao_e_armazenada_em_claro(){
        let encoded=hash_password("uma-senha-forte-123").expect("gerar hash");
        assert_ne!(encoded,"uma-senha-forte-123");
        assert!(verify_password("uma-senha-forte-123",&encoded));
        assert!(!verify_password("senha-errada",&encoded));
    }

    #[test]
    fn permissoes_completas_incluem_modulos_sensiveis(){
        let permissions=full_permissions();
        assert!(permission_allowed(&permissions,"openFinance","view"));
        assert!(permission_allowed(&permissions,"investments","edit"));
    }

    #[test]
    fn upsert_isola_registro_por_workspace(){
        let mut connection=Connection::open_in_memory().unwrap();
        configure_database(&connection).unwrap();
        let transaction=connection.transaction().unwrap();
        let id=upsert_in_transaction(&transaction,EntityInput{entity_type:"cards".to_string(),id:None,data:json!({"name":"Cartão teste"})},"workspace-1").unwrap();
        transaction.commit().unwrap();
        let workspace:String=connection.query_row("SELECT workspace_id FROM entities WHERE id=?1",params![id],|row|row.get(0)).unwrap();
        assert_eq!(workspace,"workspace-1");
    }
}
