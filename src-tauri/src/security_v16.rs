use std::{fs, path::{Path, PathBuf}, time::Duration};

use rand_core::{OsRng, RngCore};
use rusqlite::{backup::Backup, Connection};
use windows_dpapi::{decrypt_data, encrypt_data, Scope};

const KEY_FILE_NAME: &str = "financa-simples.key.dpapi";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn quote_sql_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn key_path(database_path: &Path) -> Result<PathBuf, String> {
    Ok(database_path
        .parent()
        .ok_or_else(|| "pasta do banco local inválida".to_string())?
        .join(KEY_FILE_NAME))
}

fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

fn save_key(database_path: &Path, key: &[u8]) -> Result<(), String> {
    let protected = encrypt_data(key, Scope::User, None)
        .map_err(|error| format!("falha ao proteger chave local com Windows DPAPI: {error}"))?;
    let path = key_path(database_path)?;
    fs::write(path, protected)
        .map_err(|error| format!("falha ao salvar chave protegida do banco: {error}"))
}

fn load_key(database_path: &Path) -> Result<Option<Vec<u8>>, String> {
    let path = key_path(database_path)?;
    if !path.exists() {
        return Ok(None);
    }
    let protected = fs::read(path)
        .map_err(|error| format!("falha ao ler chave protegida do banco: {error}"))?;
    let key = decrypt_data(&protected, Scope::User, None)
        .map_err(|error| format!("não foi possível desbloquear os dados deste Windows: {error}"))?;
    if key.len() != 32 {
        return Err("chave local do banco possui tamanho inválido".to_string());
    }
    Ok(Some(key))
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

    let mut target = Connection::open(&destination)
        .map_err(|error| format!("falha ao criar destino do backup: {error}"))?;
    apply_key(&target, &key)?;
    {
        let backup = Backup::new(source, &mut target)
            .map_err(|error| format!("falha ao iniciar backup consistente: {error}"))?;
        backup
            .run_to_completion(128, Duration::from_millis(10), None)
            .map_err(|error| format!("falha durante backup consistente: {error}"))?;
    }
    quick_check(&target)?;
    Ok(destination.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chave_aleatoria_tem_256_bits() {
        assert_eq!(generate_key().len(), 32);
    }
}
