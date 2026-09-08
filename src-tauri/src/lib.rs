use std::{fs, sync::Mutex};

use chrono::{Datelike, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use uuid::Uuid;

struct LocalDb(Mutex<Connection>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionRow {
    id: String,
    kind: String,
    description: String,
    amount_cents: i64,
    occurred_at: String,
    account_name: String,
    category_name: String,
    sync_state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Dashboard {
    balance_cents: i64,
    income_month_cents: i64,
    expense_month_cents: i64,
    pending_sync: i64,
    recent_transactions: Vec<TransactionRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    storage: String,
    offline_ready: bool,
    sync_queue_enabled: bool,
    online_only_features: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTransaction {
    kind: String,
    description: String,
    amount_cents: i64,
    account_id: Option<String>,
    category_id: Option<String>,
    occurred_at: Option<String>,
}

fn configure_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|error| format!("falha ao configurar SQLite: {error}"))?;

    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                account_type TEXT NOT NULL DEFAULT 'cash',
                opening_balance_cents INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                category_id TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
                description TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                occurred_at TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                remote_id TEXT,
                sync_state TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(account_id) REFERENCES accounts(id),
                FOREIGN KEY(category_id) REFERENCES categories(id)
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at
              ON transactions(occurred_at DESC);
            CREATE INDEX IF NOT EXISTS idx_transactions_sync_state
              ON transactions(sync_state);

            CREATE TABLE IF NOT EXISTS sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                payload_json TEXT NOT NULL,
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

            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .map_err(|error| format!("falha ao criar estrutura local: {error}"))?;

    seed_defaults(connection)?;
    Ok(())
}

fn seed_defaults(connection: &Connection) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();

    connection
        .execute(
            "INSERT OR IGNORE INTO accounts
             (id, name, account_type, opening_balance_cents, created_at, updated_at)
             VALUES ('account-main', 'Conta principal', 'cash', 0, ?1, ?1)",
            params![&now],
        )
        .map_err(|error| error.to_string())?;

    let categories = [
        ("cat-income", "Receitas", "income"),
        ("cat-sales", "Vendas", "income"),
        ("cat-services", "Serviços", "income"),
        ("cat-expense", "Despesas gerais", "expense"),
        ("cat-suppliers", "Fornecedores", "expense"),
        ("cat-payroll", "Folha e encargos", "expense"),
        ("cat-taxes", "Tributos", "expense"),
    ];

    for (id, name, kind) in categories {
        connection
            .execute(
                "INSERT OR IGNORE INTO categories
                 (id, name, kind, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, name, kind, &now],
            )
            .map_err(|error| error.to_string())?;
    }

    connection
        .execute(
            "INSERT OR REPLACE INTO app_metadata(key, value)
             VALUES ('schema_version', '1')",
            [],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn read_recent_transactions(connection: &Connection, limit: i64) -> Result<Vec<TransactionRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.kind, t.description, t.amount_cents, t.occurred_at,
                    a.name, c.name, t.sync_state
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             JOIN categories c ON c.id = t.category_id
             ORDER BY t.occurred_at DESC, t.created_at DESC
             LIMIT ?1",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![limit.clamp(1, 200)], |row| {
            Ok(TransactionRow {
                id: row.get(0)?,
                kind: row.get(1)?,
                description: row.get(2)?,
                amount_cents: row.get(3)?,
                occurred_at: row.get(4)?,
                account_name: row.get(5)?,
                category_name: row.get(6)?,
                sync_state: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn runtime_status() -> RuntimeStatus {
    RuntimeStatus {
        storage: "SQLite local (WAL)".to_string(),
        offline_ready: true,
        sync_queue_enabled: true,
        online_only_features: vec![
            "Open Finance / Pluggy".to_string(),
            "cotações em tempo real".to_string(),
            "IA e agente conectado".to_string(),
            "sincronização entre dispositivos".to_string(),
            "atualizações do aplicativo".to_string(),
        ],
    }
}

#[tauri::command]
fn dashboard(db: State<'_, LocalDb>) -> Result<Dashboard, String> {
    let connection = db.0.lock().map_err(|_| "banco local indisponível".to_string())?;
    let now = Utc::now();
    let month_prefix = format!("{:04}-{:02}", now.year(), now.month());

    let opening_balance: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(opening_balance_cents), 0)
             FROM accounts WHERE archived = 0",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let movements: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_cents ELSE -amount_cents END), 0)
             FROM transactions",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let income_month_cents: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0)
             FROM transactions
             WHERE kind = 'income' AND substr(occurred_at, 1, 7) = ?1",
            params![&month_prefix],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let expense_month_cents: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0)
             FROM transactions
             WHERE kind = 'expense' AND substr(occurred_at, 1, 7) = ?1",
            params![&month_prefix],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let pending_sync: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    Ok(Dashboard {
        balance_cents: opening_balance + movements,
        income_month_cents,
        expense_month_cents,
        pending_sync,
        recent_transactions: read_recent_transactions(&connection, 12)?,
    })
}

#[tauri::command]
fn list_transactions(db: State<'_, LocalDb>, limit: Option<i64>) -> Result<Vec<TransactionRow>, String> {
    let connection = db.0.lock().map_err(|_| "banco local indisponível".to_string())?;
    read_recent_transactions(&connection, limit.unwrap_or(100))
}

#[tauri::command]
fn create_transaction(db: State<'_, LocalDb>, input: NewTransaction) -> Result<TransactionRow, String> {
    let kind = input.kind.trim().to_lowercase();
    if kind != "income" && kind != "expense" {
        return Err("tipo de lançamento inválido".to_string());
    }
    if input.amount_cents <= 0 {
        return Err("o valor deve ser maior que zero".to_string());
    }

    let description = input.description.trim().to_string();
    if description.is_empty() {
        return Err("informe uma descrição".to_string());
    }

    let account_id = input.account_id.unwrap_or_else(|| "account-main".to_string());
    let category_id = input.category_id.unwrap_or_else(|| {
        if kind == "income" {
            "cat-income".to_string()
        } else {
            "cat-expense".to_string()
        }
    });
    let occurred_at = input
        .occurred_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();

    let payload = serde_json::json!({
        "id": &id,
        "accountId": &account_id,
        "categoryId": &category_id,
        "kind": &kind,
        "description": &description,
        "amountCents": input.amount_cents,
        "occurredAt": &occurred_at,
        "source": "manual"
    });

    let mut connection = db.0.lock().map_err(|_| "banco local indisponível".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;

    transaction
        .execute(
            "INSERT INTO transactions
             (id, account_id, category_id, kind, description, amount_cents, occurred_at,
              source, sync_state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual', 'pending', ?8, ?8)",
            params![
                &id,
                &account_id,
                &category_id,
                &kind,
                &description,
                input.amount_cents,
                &occurred_at,
                &now
            ],
        )
        .map_err(|error| format!("não foi possível salvar o lançamento: {error}"))?;

    transaction
        .execute(
            "INSERT INTO sync_queue
             (entity_type, entity_id, operation, payload_json, status, created_at, updated_at)
             VALUES ('transaction', ?1, 'upsert', ?2, 'pending', ?3, ?3)",
            params![&id, payload.to_string(), &now],
        )
        .map_err(|error| format!("não foi possível preparar a sincronização: {error}"))?;

    transaction.commit().map_err(|error| error.to_string())?;

    let row = connection
        .query_row(
            "SELECT t.id, t.kind, t.description, t.amount_cents, t.occurred_at,
                    a.name, c.name, t.sync_state
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             JOIN categories c ON c.id = t.category_id
             WHERE t.id = ?1",
            params![&id],
            |row| {
                Ok(TransactionRow {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    description: row.get(2)?,
                    amount_cents: row.get(3)?,
                    occurred_at: row.get(4)?,
                    account_name: row.get(5)?,
                    category_name: row.get(6)?,
                    sync_state: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "lançamento não encontrado após salvar".to_string())?;

    Ok(row)
}

fn build_local_db(app: &tauri::App) -> Result<LocalDb, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("não foi possível localizar a pasta de dados: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("não foi possível criar a pasta de dados: {error}"))?;

    let database_path = app_data_dir.join("financa-simples.sqlite3");
    let connection = Connection::open(database_path)
        .map_err(|error| format!("não foi possível abrir o banco local: {error}"))?;
    configure_database(&connection)?;
    Ok(LocalDb(Mutex::new(connection)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let local_db = build_local_db(app).map_err(|error| -> Box<dyn std::error::Error> {
                Box::new(std::io::Error::other(error))
            })?;
            app.manage(local_db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            dashboard,
            list_transactions,
            create_transaction
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Financa Simples");
}
