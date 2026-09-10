use std::collections::{HashMap, HashSet};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use super::*;

const SUPABASE_URL: &str = "https://jozjcqskvkwxoaqmthrj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_pIcoV3Oq9FZSzVvTXQy8GQ_5Zf9SXq8";

#[derive(Debug, Deserialize)]
struct CloudUser {
    id: String,
    email: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct CloudWorkspace {
    id: String,
    name: String,
    owner_user_id: String,
    role: String,
    permissions: Value,
    is_owner: bool,
}

#[derive(Debug, Deserialize)]
struct CloudProfile {
    is_platform_admin: bool,
}

#[derive(Debug, Deserialize, Clone)]
struct RemoteEntity {
    id: String,
    workspace_id: String,
    entity_type: String,
    data_json: Value,
    version: i64,
    deleted: bool,
    #[allow(dead_code)]
    updated_by: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone)]
struct LocalSyncEntity {
    id: String,
    entity_type: String,
    data_json: String,
    version: i64,
    sync_state: String,
    deleted: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudSyncResult {
    online: bool,
    uploaded: usize,
    downloaded: usize,
    skipped: usize,
    pending: usize,
    message: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .build()
        .map_err(|error| format!("falha ao preparar conexão segura com a nuvem: {error}"))
}

fn headers(request: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    request
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .bearer_auth(token)
        .header("Cache-Control", "no-store")
}

async fn response_error(response: reqwest::Response, context: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value.get("message")
                .or_else(|| value.get("msg"))
                .or_else(|| value.get("error_description"))
                .or_else(|| value.get("error"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(240).collect());
    format!("{context} ({status}): {detail}")
}

async fn validate_user(http: &Client, token: &str) -> Result<CloudUser, String> {
    let response = headers(http.get(format!("{SUPABASE_URL}/auth/v1/user")), token)
        .send()
        .await
        .map_err(|error| format!("não foi possível validar a sessão cloud: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "sessão cloud inválida").await);
    }
    response
        .json::<CloudUser>()
        .await
        .map_err(|error| format!("resposta de identidade inválida: {error}"))
}

async fn fetch_workspaces(http: &Client, token: &str) -> Result<Vec<CloudWorkspace>, String> {
    let response = headers(
        http.post(format!("{SUPABASE_URL}/rest/v1/rpc/fs_my_workspaces")),
        token,
    )
    .json(&json!({}))
    .send()
    .await
    .map_err(|error| format!("não foi possível consultar ambientes cloud: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "falha ao consultar ambientes cloud").await);
    }
    response
        .json::<Vec<CloudWorkspace>>()
        .await
        .map_err(|error| format!("lista de ambientes cloud inválida: {error}"))
}

async fn fetch_platform_admin(http: &Client, token: &str, user_id: &str) -> Result<bool, String> {
    let response = headers(
        http.get(format!("{SUPABASE_URL}/rest/v1/profiles")).query(&[
            ("id", format!("eq.{user_id}")),
            ("select", "is_platform_admin".to_string()),
        ]),
        token,
    )
    .send()
    .await
    .map_err(|error| format!("não foi possível consultar perfil cloud: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "falha ao consultar perfil cloud").await);
    }
    let rows = response
        .json::<Vec<CloudProfile>>()
        .await
        .map_err(|error| format!("perfil cloud inválido: {error}"))?;
    Ok(rows.first().map(|row| row.is_platform_admin).unwrap_or(false))
}

fn placeholder_email(cloud_user_id: &str) -> String {
    let compact: String = cloud_user_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(24)
        .collect();
    format!("owner-{compact}@local.invalid")
}

fn current_status(db: &LocalDb, auth: &AuthState) -> Result<AuthStatus, String> {
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
pub(crate) async fn cloud_reconcile_login(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    access_token: String,
    password: String,
) -> Result<AuthStatus, String> {
    validate_password(&password)?;
    let http = client()?;
    let user = validate_user(&http, &access_token).await?;
    let workspaces = fetch_workspaces(&http, &access_token).await?;
    let is_platform_admin = fetch_platform_admin(&http, &access_token, &user.id)
        .await
        .unwrap_or(false);

    let email = validate_email(user.email.as_deref().unwrap_or_default())?;
    let password_hash = hash_password(&password)?;
    let now = Utc::now().to_rfc3339();
    let mut connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;

    let existing_local: Option<String> = connection
        .query_row(
            "SELECT id FROM users WHERE email = ?1",
            params![email],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let local_user_id = existing_local.unwrap_or_else(|| user.id.clone());
    let previous_workspace: Option<String> = connection
        .query_row(
            "SELECT workspace_id FROM memberships WHERE user_id = ?1 AND active = 1 ORDER BY created_at LIMIT 1",
            params![local_user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO users(id,email,password_hash,is_super_admin,active,created_at,updated_at)
             VALUES (?1,?2,?3,?4,1,?5,?5)
             ON CONFLICT(email) DO UPDATE SET
               password_hash=excluded.password_hash,
               is_super_admin=excluded.is_super_admin,
               active=1,
               updated_at=excluded.updated_at",
            params![
                local_user_id,
                email,
                password_hash,
                if is_platform_admin { 1 } else { 0 },
                now
            ],
        )
        .map_err(|error| format!("falha ao reconciliar usuário local: {error}"))?;

    transaction
        .execute(
            "UPDATE memberships SET active=0, updated_at=?1 WHERE user_id=?2",
            params![now, local_user_id],
        )
        .map_err(|error| error.to_string())?;

    for workspace in &workspaces {
        let local_owner_id = if workspace.is_owner || workspace.owner_user_id == user.id {
            local_user_id.clone()
        } else {
            workspace.owner_user_id.clone()
        };

        if local_owner_id != local_user_id {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO users(id,email,password_hash,is_super_admin,active,created_at,updated_at)
                     VALUES (?1,?2,'!',0,0,?3,?3)",
                    params![
                        local_owner_id,
                        placeholder_email(&workspace.owner_user_id),
                        now
                    ],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction
            .execute(
                "INSERT INTO workspaces(id,name,owner_user_id,active,created_at,updated_at)
                 VALUES (?1,?2,?3,1,?4,?4)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name,
                   owner_user_id=excluded.owner_user_id,
                   active=1,
                   updated_at=excluded.updated_at",
                params![workspace.id, workspace.name, local_owner_id, now],
            )
            .map_err(|error| format!("falha ao reconciliar ambiente local: {error}"))?;

        transaction
            .execute(
                "INSERT INTO memberships(user_id,workspace_id,role,permissions_json,active,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,1,?5,?5)
                 ON CONFLICT(user_id,workspace_id) DO UPDATE SET
                   role=excluded.role,
                   permissions_json=excluded.permissions_json,
                   active=1,
                   updated_at=excluded.updated_at",
                params![
                    local_user_id,
                    workspace.id,
                    workspace.role,
                    workspace.permissions.to_string(),
                    now
                ],
            )
            .map_err(|error| format!("falha ao reconciliar permissões locais: {error}"))?;
    }

    if let (Some(old_workspace), Some(first_cloud)) = (previous_workspace.as_ref(), workspaces.first()) {
        if !workspaces.iter().any(|workspace| &workspace.id == old_workspace) {
            transaction
                .execute(
                    "UPDATE entities SET workspace_id=?1, sync_state='local', updated_at=?2 WHERE workspace_id=?3",
                    params![first_cloud.id, now, old_workspace],
                )
                .map_err(|error| format!("falha ao migrar dados locais para ambiente cloud: {error}"))?;
        }
    }

    transaction.commit().map_err(|error| error.to_string())?;
    audit(
        &connection,
        Some(&local_user_id),
        workspaces.first().map(|workspace| workspace.id.as_str()),
        "cloud_identity_reconcile",
        json!({"cloudUserId": user.id}),
    );
    drop(connection);

    {
        let mut session = auth
            .session
            .lock()
            .map_err(|_| "sessão indisponível".to_string())?;
        session.user_id = Some(local_user_id);
        let preferred = session.active_workspace_id.clone();
        session.active_workspace_id = preferred
            .filter(|id| workspaces.iter().any(|workspace| &workspace.id == id))
            .or_else(|| workspaces.first().map(|workspace| workspace.id.clone()));
    }

    current_status(&db, &auth)
}

#[tauri::command]
pub(crate) async fn cloud_ensure_workspace(
    access_token: String,
    workspace_id: String,
    name: String,
) -> Result<String, String> {
    let http = client()?;
    let _ = validate_user(&http, &access_token).await?;
    let response = headers(
        http.post(format!("{SUPABASE_URL}/rest/v1/rpc/fs_ensure_workspace")),
        &access_token,
    )
    .json(&json!({
        "p_workspace_id": workspace_id,
        "p_name": name
    }))
    .send()
    .await
    .map_err(|error| format!("não foi possível criar ambiente cloud: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "falha ao criar ambiente cloud").await);
    }
    response
        .json::<String>()
        .await
        .map_err(|error| format!("identificador de ambiente cloud inválido: {error}"))
}

fn local_rows(connection: &Connection, workspace_id: &str) -> Result<Vec<LocalSyncEntity>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id,entity_type,data_json,version,sync_state,deleted,created_at,updated_at
             FROM entities WHERE workspace_id=?1",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![workspace_id], |row| {
            Ok(LocalSyncEntity {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                data_json: row.get(2)?,
                version: row.get(3)?,
                sync_state: row.get(4)?,
                deleted: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

async fn remote_rows(
    http: &Client,
    token: &str,
    workspace_id: &str,
) -> Result<Vec<RemoteEntity>, String> {
    let response = headers(
        http.get(format!("{SUPABASE_URL}/rest/v1/financial_entities"))
            .query(&[
                ("workspace_id", format!("eq.{workspace_id}")),
                (
                    "select",
                    "id,workspace_id,entity_type,data_json,version,deleted,updated_by,created_at,updated_at"
                        .to_string(),
                ),
            ]),
        token,
    )
    .send()
    .await
    .map_err(|error| format!("falha ao baixar dados cloud: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "falha ao baixar dados cloud").await);
    }
    response
        .json::<Vec<RemoteEntity>>()
        .await
        .map_err(|error| format!("dados cloud inválidos: {error}"))
}

fn apply_remote(connection: &Connection, remote: &RemoteEntity) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO entities(id,workspace_id,entity_type,data_json,version,sync_state,deleted,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,'synced',?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET
               workspace_id=excluded.workspace_id,
               entity_type=excluded.entity_type,
               data_json=excluded.data_json,
               version=excluded.version,
               sync_state='synced',
               deleted=excluded.deleted,
               created_at=excluded.created_at,
               updated_at=excluded.updated_at",
            params![
                remote.id,
                remote.workspace_id,
                remote.entity_type,
                remote.data_json.to_string(),
                remote.version,
                if remote.deleted { 1 } else { 0 },
                remote.created_at,
                remote.updated_at
            ],
        )
        .map_err(|error| format!("falha ao aplicar atualização cloud localmente: {error}"))?;
    Ok(())
}

async fn upload_local(
    http: &Client,
    token: &str,
    cloud_user_id: &str,
    workspace_id: &str,
    local: &LocalSyncEntity,
    exists_remote: bool,
) -> Result<(), String> {
    let data_json = serde_json::from_str::<Value>(&local.data_json).unwrap_or(Value::Null);
    let payload = json!({
        "id": local.id,
        "workspace_id": workspace_id,
        "entity_type": local.entity_type,
        "data_json": data_json,
        "version": local.version,
        "deleted": local.deleted,
        "updated_by": cloud_user_id,
        "created_at": local.created_at,
        "updated_at": local.updated_at
    });

    let request = if exists_remote {
        http.patch(format!("{SUPABASE_URL}/rest/v1/financial_entities"))
            .query(&[
                ("workspace_id", format!("eq.{workspace_id}")),
                ("id", format!("eq.{}", local.id)),
            ])
    } else {
        http.post(format!("{SUPABASE_URL}/rest/v1/financial_entities"))
    };

    let response = headers(request, token)
        .header("Prefer", "return=minimal")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("falha ao enviar alteração cloud: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "alteração recusada pela nuvem").await);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn cloud_sync(
    db: State<'_, LocalDb>,
    auth: State<'_, AuthState>,
    access_token: String,
) -> Result<CloudSyncResult, String> {
    let http = client()?;
    let cloud_user = validate_user(&http, &access_token).await?;
    let workspaces = fetch_workspaces(&http, &access_token).await?;
    let session = auth
        .session
        .lock()
        .map_err(|_| "sessão indisponível".to_string())?
        .clone();
    let workspace_id = session
        .active_workspace_id
        .ok_or_else(|| "nenhum ambiente selecionado".to_string())?;
    let cloud_workspace = workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| "acesso cloud a este ambiente foi revogado".to_string())?;

    let locals = {
        let connection = db
            .connection
            .lock()
            .map_err(|_| "banco local indisponível".to_string())?;
        local_rows(&connection, &workspace_id)?
    };
    let remotes = remote_rows(&http, &access_token, &workspace_id).await?;
    let permissions = cloud_workspace.permissions.clone();
    let remote_map: HashMap<String, RemoteEntity> = remotes
        .iter()
        .cloned()
        .map(|row| (row.id.clone(), row))
        .collect();
    let local_map: HashMap<String, LocalSyncEntity> = locals
        .iter()
        .cloned()
        .map(|row| (row.id.clone(), row))
        .collect();

    let mut uploaded = 0usize;
    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let mut uploaded_ids = HashSet::new();

    for local in &locals {
        let remote = remote_map.get(&local.id);
        let local_dirty = local.sync_state != "synced";
        let remote_newer = remote
            .map(|row| {
                row.version > local.version
                    || (row.version == local.version && row.updated_at > local.updated_at)
            })
            .unwrap_or(false);

        if local_dirty && !remote_newer {
            let action = if remote.is_some() { "edit" } else { "create" };
            let module = entity_module(&local.entity_type);
            if permission_allowed(&permissions, module, action) {
                upload_local(
                    &http,
                    &access_token,
                    &cloud_user.id,
                    &workspace_id,
                    local,
                    remote.is_some(),
                )
                .await?;
                uploaded += 1;
                uploaded_ids.insert(local.id.clone());
            } else {
                skipped += 1;
            }
        }
    }

    let connection = db
        .connection
        .lock()
        .map_err(|_| "banco local indisponível".to_string())?;
    for remote in &remotes {
        let local = local_map.get(&remote.id);
        let local_dirty = local
            .map(|row| row.sync_state != "synced")
            .unwrap_or(false);
        let local_newer = local
            .map(|row| {
                row.version > remote.version
                    || (row.version == remote.version && row.updated_at > remote.updated_at)
            })
            .unwrap_or(false);
        if local.is_none()
            || (!uploaded_ids.contains(&remote.id) && (!local_dirty || !local_newer))
        {
            apply_remote(&connection, remote)?;
            downloaded += 1;
        }
    }

    for local in &locals {
        if uploaded_ids.contains(&local.id) {
            connection
                .execute(
                    "UPDATE entities SET sync_state='synced'
                     WHERE id=?1 AND workspace_id=?2 AND version=?3",
                    params![local.id, workspace_id, local.version],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    let pending: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM entities WHERE workspace_id=?1 AND sync_state!='synced'",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    audit(
        &connection,
        session.user_id.as_deref(),
        Some(&workspace_id),
        "cloud_sync",
        json!({
            "uploaded": uploaded,
            "downloaded": downloaded,
            "skipped": skipped,
            "pending": pending
        }),
    );

    Ok(CloudSyncResult {
        online: true,
        uploaded,
        downloaded,
        skipped,
        pending: pending.max(0) as usize,
        message: if pending == 0 {
            "Sincronização concluída".to_string()
        } else {
            format!("Sincronização parcial: {pending} alteração(ões) pendente(s)")
        },
    })
}
