use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rand_core::{OsRng, RngCore};
use rusqlite::{backup::Backup, Connection};
use windows_dpapi::{decrypt_data, encrypt_data, Scope};

const KEY_FILE_NAME: &str = "financa-simples.key.dpapi";
const RECOVERY_KEY_FILE_NAME: &str = "financa-simples.recovery-key.dpapi";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_hex_32(value: &str) -> Result<Vec<u8>, String> {
    let clean = value.trim();
    if clean.len() != 64 || !clean.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("chave de recuperação inválida; informe os 64 caracteres exibidos pelo Finança Simples".to_string());
    }
    let mut out = Vec::with_capacity(32);
    for index in (0..64).step_by(2) {
        out.push(
            u8::from_str_radix(&clean[index..index + 2], 16)
                .map_err(|_| "chave de recuperação inválida".to_string())?,
        );
    }
    Ok(out)
}

fn quote_sql_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn sibling_path(database_path: &Path, name: &str) -> Result<PathBuf, String> {
    Ok(database_path
        .parent()
        .ok_or_else(|| "pasta do banco local inválida".to_string())?
        .join(name))
}

fn key_path(database_path: &Path) -> Result<PathBuf, String> {
    sibling_path(database_path, KEY_FILE_NAME)
}

fn recovery_key_path(database_path: &Path) -> Result<PathBuf, String> {
    sibling_path(database_path, RECOVERY_KEY_FILE_NAME)
}

fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

fn protect_to_file(path: &Path, key: &[u8], label: &str) -> Result<(), String> {
    let protected = encrypt_data(key, Scope::User, None)
        .map_err(|error| format!("falha ao proteger {label} com Windows DPAPI: {error}"))?;
    fs::write(path, protected).map_err(|error| format!("falha ao salvar {label}: {error}"))
}

fn unprotect_from_file(path: &Path, label: &str) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let protected = fs::read(path).map_err(|error| format!("falha ao ler {label}: {error}"))?;
    let key = decrypt_data(&protected, Scope::User, None)
        .map_err(|error| format!("não foi possível desbloquear {label} neste Windows: {error}"))?;
    if key.len() != 32 {
        return Err(format!("{label} possui tamanho inválido"));
    }
    Ok(Some(key))
}

fn save_key(database_path: &Path, key: &[u8]) -> Result<(), String> {
    protect_to_file(&key_path(database_path)?, key, "chave local do banco")
}

fn load_key(database_path: &Path) -> Result<Option<Vec<u8>>, String> {
    unprotect_from_file(&key_path(database_path)?, "chave local do banco")
}

fn get_or_create_recovery_key(database_path: &Path) -> Result<Vec<u8>, String> {
    let path = recovery_key_path(database_path)?;
    if let Some(key) = unprotect_from_file(&path, "chave de recuperação")? {
        return Ok(key);
    }
    let key = generate_key().to_vec();
    protect_to_file(&path, &key, "chave de recuperação")?;
    Ok(key)
}

pub(crate) fn recovery_key_hex(database_path: &Path) -> Result<String, String> {
    get_or_create_recovery_key(database_path).map(|key| hex(&key))
}

fn apply_key(connection: &Connection, key: &[u8]) -> Result<(), String> {
    let statement = format!(
        "PRAGMA key = \"x'{}'\";\nPRAGMA cipher_memory_security = ON;\nPRAGMA foreign_keys = ON;",
        hex(key)
    );
    connection
        .execute_batch(&statement)
        .map_err(|error| format!("falha ao desbloquear banco criptografado: {error}"))?;

    let version: String = connection
        .query_row("PRAGMA cipher_version;", [], |row| row.get(0))
        .map_err(|error| format!("SQLCipher não está disponível nesta compilação: {error}"))?;
    if version.trim().is_empty() {
        return Err("SQLCipher não respondeu com uma versão válida".to_string());
    }
    Ok(())
}

fn quick_check(connection: &Connection) -> Result<(), String> {
    let check: String = connection
        .query_row("PRAGMA quick_check;", [], |row| row.get(0))
        .map_err(|error| format!("falha ao validar banco: {error}"))?;
    if !check.eq_ignore_ascii_case("ok") {
        return Err(format!("integridade do banco inválida: {check}"));
    }
    Ok(())
}

fn validate_financa_database(connection: &Connection) -> Result<(), String> {
    quick_check(connection)?;
    let marker: Option<String> = connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key='product_scope'",
            [],
            |row| row.get(0),
        )
        .ok();
    if marker.as_deref() != Some("financa-simples") {
        return Err("o arquivo não foi reconhecido como backup do Finança Simples".to_string());
    }
    Ok(())
}

fn looks_like_plaintext(database_path: &Path) -> bool {
    if !database_path.exists() {
        return false;
    }
    let Ok(connection) = Connection::open(database_path) else {
        return false;
    };
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))
        .is_ok()
}

fn migrate_plaintext(database_path: &Path, key: &[u8]) -> Result<(), String> {
    let parent = database_path
        .parent()
        .ok_or_else(|| "pasta do banco local inválida".to_string())?;
    let encrypted_path = parent.join("financa-simples.encrypted-migration.sqlite3");
    let legacy_path = parent.join("financa-simples.legacy-plaintext.sqlite3");
    let _ = fs::remove_file(&encrypted_path);
    let _ = fs::remove_file(&legacy_path);

    let plaintext = Connection::open(database_path)
        .map_err(|error| format!("falha ao abrir banco legado para migração: {error}"))?;
    quick_check(&plaintext)?;
    plaintext
        .execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|error| format!("falha ao consolidar banco legado antes da migração: {error}"))?;

    let attach = format!(
        "ATTACH DATABASE '{}' AS encrypted KEY \"x'{}'\";\nSELECT sqlcipher_export('encrypted');\nDETACH DATABASE encrypted;",
        quote_sql_path(&encrypted_path),
        hex(key)
    );
    plaintext
        .execute_batch(&attach)
        .map_err(|error| format!("falha ao criptografar banco legado: {error}"))?;
    drop(plaintext);

    let encrypted = Connection::open(&encrypted_path)
        .map_err(|error| format!("falha ao abrir banco migrado: {error}"))?;
    apply_key(&encrypted, key)?;
    quick_check(&encrypted)?;
    drop(encrypted);

    fs::rename(database_path, &legacy_path)
        .map_err(|error| format!("falha ao preservar banco legado durante migração: {error}"))?;
    if let Err(error) = fs::rename(&encrypted_path, database_path) {
        let _ = fs::rename(&legacy_path, database_path);
        return Err(format!("falha ao ativar banco criptografado: {error}"));
    }

    // Removido somente depois da validação e troca atômica. Em SSD/NTFS, remoção lógica
    // não garante apagamento físico; BitLocker continua recomendado para proteção de resíduos.
    let _ = fs::remove_file(&legacy_path);
    let _ = fs::remove_file(format!("{}-wal", database_path.to_string_lossy()));
    let _ = fs::remove_file(format!("{}-shm", database_path.to_string_lossy()));
    Ok(())
}

pub(crate) fn open_secure_database(database_path: &Path) -> Result<Connection, String> {
    let mut key = load_key(database_path)?;
    if key.is_none() {
        let generated = generate_key().to_vec();
        save_key(database_path, &generated)?;
        key = Some(generated);
    }
    let key = key.ok_or_else(|| "chave local indisponível".to_string())?;

    if database_path.exists() {
        let encrypted_attempt = Connection::open(database_path)
            .map_err(|error| format!("falha ao abrir banco local: {error}"))?;
        let encrypted_ok = apply_key(&encrypted_attempt, &key)
            .and_then(|_| quick_check(&encrypted_attempt))
            .is_ok();
        drop(encrypted_attempt);

        if !encrypted_ok {
            if looks_like_plaintext(database_path) {
                migrate_plaintext(database_path, &key)?;
            } else {
                return Err("o banco local existe, mas não pôde ser desbloqueado nem reconhecido como base legada; restaure um backup válido".to_string());
            }
        }
    }

    let connection = Connection::open(database_path)
        .map_err(|error| format!("não foi possível abrir o banco local criptografado: {error}"))?;
    apply_key(&connection, &key)?;
    quick_check(&connection)?;
    Ok(connection)
}

fn backup_to_keyed_file(source: &Connection, destination: &Path, key: &[u8]) -> Result<(), String> {
    let _ = fs::remove_file(destination);
    let mut target = Connection::open(destination)
        .map_err(|error| format!("falha ao criar destino do backup: {error}"))?;
    apply_key(&target, key)?;
    {
        let backup = Backup::new(source, &mut target)
            .map_err(|error| format!("falha ao iniciar backup consistente: {error}"))?;
        backup
            .run_to_completion(128, Duration::from_millis(10), None)
            .map_err(|error| format!("falha durante backup consistente: {error}"))?;
    }
    validate_financa_database(&target)?;
    Ok(())
}

pub(crate) fn create_consistent_backup(source: &Connection, database_path: &Path) -> Result<String, String> {
    let key = load_key(database_path)?
        .ok_or_else(|| "chave do banco criptografado não encontrada".to_string())?;
    let parent = database_path
        .parent()
        .ok_or_else(|| "pasta de dados inválida".to_string())?;
    let backup_dir = parent.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("falha ao criar pasta de backup: {error}"))?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let destination = backup_dir.join(format!("financa-simples-{stamp}.sqlite3"));
    backup_to_keyed_file(source, &destination, &key)?;
    Ok(destination.to_string_lossy().to_string())
}

pub(crate) fn create_portable_backup(
    source: &Connection,
    database_path: &Path,
) -> Result<(String, String), String> {
    let recovery_key = get_or_create_recovery_key(database_path)?;
    let parent = database_path
        .parent()
        .ok_or_else(|| "pasta de dados inválida".to_string())?;
    let backup_dir = parent.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("falha ao criar pasta de backup: {error}"))?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let destination = backup_dir.join(format!("financa-simples-portatil-{stamp}.fsbackup"));
    backup_to_keyed_file(source, &destination, &recovery_key)?;
    Ok((destination.to_string_lossy().to_string(), hex(&recovery_key)))
}

fn restore_connection_from(
    source_path: &Path,
    source_key: &[u8],
    target: &mut Connection,
) -> Result<(), String> {
    let source = Connection::open(source_path)
        .map_err(|error| format!("não foi possível abrir o backup: {error}"))?;
    apply_key(&source, source_key)?;
    validate_financa_database(&source)?;
    {
        let backup = Backup::new(&source, target)
            .map_err(|error| format!("falha ao preparar restauração: {error}"))?;
        backup
            .run_to_completion(128, Duration::from_millis(10), None)
            .map_err(|error| format!("falha durante restauração: {error}"))?;
    }
    validate_financa_database(target)?;
    Ok(())
}

pub(crate) fn restore_portable_backup(
    target: &mut Connection,
    database_path: &Path,
    backup_path: &Path,
    recovery_key_hex: &str,
) -> Result<String, String> {
    if !backup_path.exists() || !backup_path.is_file() {
        return Err("arquivo de backup não encontrado".to_string());
    }
    if backup_path.extension().and_then(|value| value.to_str()) != Some("fsbackup") {
        return Err("selecione um arquivo .fsbackup criado pelo Finança Simples".to_string());
    }
    let recovery_key = parse_hex_32(recovery_key_hex)?;

    // Valida integralmente o backup antes de tocar no banco em uso.
    let probe = Connection::open(backup_path)
        .map_err(|error| format!("não foi possível abrir o backup: {error}"))?;
    apply_key(&probe, &recovery_key)
        .map_err(|_| "backup ou chave de recuperação inválidos".to_string())?;
    validate_financa_database(&probe)
        .map_err(|error| format!("backup inválido: {error}"))?;
    drop(probe);

    // Cria snapshot consistente do estado atual para rollback automático.
    let safety_path = PathBuf::from(create_consistent_backup(target, database_path)?);
    let local_key = load_key(database_path)?
        .ok_or_else(|| "chave local do banco não encontrada".to_string())?;

    if let Err(error) = restore_connection_from(backup_path, &recovery_key, target) {
        let rollback = restore_connection_from(&safety_path, &local_key, target);
        return match rollback {
            Ok(_) => Err(format!("restauração recusada e estado anterior recuperado: {error}")),
            Err(rollback_error) => Err(format!("falha crítica na restauração: {error}; rollback também falhou: {rollback_error}")),
        };
    }

    Ok(safety_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chave_aleatoria_tem_256_bits() {
        assert_eq!(generate_key().len(), 32);
    }

    #[test]
    fn parser_aceita_apenas_chave_de_256_bits_em_hex() {
        let valid = "11".repeat(32);
        assert_eq!(parse_hex_32(&valid).unwrap().len(), 32);
        assert!(parse_hex_32("1234").is_err());
        assert!(parse_hex_32(&"zz".repeat(32)).is_err());
    }
}
