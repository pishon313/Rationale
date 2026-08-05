use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};
use zeroize::{Zeroize, Zeroizing};

const SERVICE: &str = "com.tradejournal.local";
const DATABASE_URL: &str = "sqlite:tradejournal.db";
const COLLECTION_STATE: &str = "__tradejournal_collection_state__";
const ENCRYPTED_BACKUP_FORMAT: &str = "rationale-encrypted-backup";
const ENCRYPTED_BACKUP_VERSION: u8 = 1;
const ARGON2_MEMORY_COST: u32 = 65_536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 12;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBackupContainer {
    format: String,
    format_version: u8,
    kdf: BackupKdf,
    cipher: BackupCipher,
    ciphertext: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupKdf {
    name: String,
    salt: String,
    memory_cost: u32,
    time_cost: u32,
    parallelism: u32,
}

#[derive(Serialize, Deserialize)]
struct BackupCipher {
    name: String,
    nonce: String,
}

fn backup_argon2() -> Result<Argon2<'static>, String> {
    let params = Params::new(
        ARGON2_MEMORY_COST,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
        Some(32),
    )
    .map_err(|_| "ENCRYPTION_FAILED".to_string())?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

fn derive_backup_key(password: &[u8], salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0_u8; 32];
    backup_argon2()?
        .hash_password_into(password, salt, &mut key)
        .map_err(|_| "ENCRYPTION_FAILED".to_string())?;
    Ok(key)
}

#[tauri::command]
fn encrypt_backup(content: String, password: String) -> Result<String, String> {
    let password = Zeroizing::new(password);
    let mut salt = [0_u8; SALT_LENGTH];
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let mut key = derive_backup_key(password.as_bytes(), &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "ENCRYPTION_FAILED".to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), content.as_bytes())
        .map_err(|_| "ENCRYPTION_FAILED".to_string());
    key.zeroize();
    let ciphertext = ciphertext?;

    serde_json::to_string_pretty(&EncryptedBackupContainer {
        format: ENCRYPTED_BACKUP_FORMAT.into(),
        format_version: ENCRYPTED_BACKUP_VERSION,
        kdf: BackupKdf {
            name: "argon2id".into(),
            salt: BASE64.encode(salt),
            memory_cost: ARGON2_MEMORY_COST,
            time_cost: ARGON2_TIME_COST,
            parallelism: ARGON2_PARALLELISM,
        },
        cipher: BackupCipher {
            name: "aes-256-gcm".into(),
            nonce: BASE64.encode(nonce_bytes),
        },
        ciphertext: BASE64.encode(ciphertext),
    })
    .map_err(|_| "ENCRYPTION_FAILED".to_string())
}

#[tauri::command]
fn decrypt_backup(container: String, password: String) -> Result<String, String> {
    let password = Zeroizing::new(password);
    let parsed: EncryptedBackupContainer =
        serde_json::from_str(&container).map_err(|_| "INVALID_ENCRYPTED_BACKUP".to_string())?;
    if parsed.format != ENCRYPTED_BACKUP_FORMAT {
        return Err("INVALID_ENCRYPTED_BACKUP".into());
    }
    if parsed.format_version != ENCRYPTED_BACKUP_VERSION {
        return Err("UNSUPPORTED_ENCRYPTED_BACKUP_VERSION".into());
    }
    if parsed.kdf.name != "argon2id"
        || parsed.kdf.memory_cost != ARGON2_MEMORY_COST
        || parsed.kdf.time_cost != ARGON2_TIME_COST
        || parsed.kdf.parallelism != ARGON2_PARALLELISM
        || parsed.cipher.name != "aes-256-gcm"
    {
        return Err("UNSUPPORTED_ENCRYPTED_BACKUP_FORMAT".into());
    }

    let salt = BASE64
        .decode(parsed.kdf.salt)
        .map_err(|_| "INVALID_ENCRYPTED_BACKUP".to_string())?;
    let nonce_bytes = BASE64
        .decode(parsed.cipher.nonce)
        .map_err(|_| "INVALID_ENCRYPTED_BACKUP".to_string())?;
    let ciphertext = BASE64
        .decode(parsed.ciphertext)
        .map_err(|_| "INVALID_ENCRYPTED_BACKUP".to_string())?;
    if salt.len() != SALT_LENGTH || nonce_bytes.len() != NONCE_LENGTH {
        return Err("INVALID_ENCRYPTED_BACKUP".into());
    }

    let mut key = derive_backup_key(password.as_bytes(), &salt)
        .map_err(|_| "DECRYPTION_FAILED".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "DECRYPTION_FAILED".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "DECRYPTION_FAILED".to_string());
    key.zeroize();
    String::from_utf8(plaintext?).map_err(|_| "DECRYPTION_FAILED".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtomicRecordWrite {
    id: String,
    data: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct AtomicCollectionWrite {
    collection: String,
    records: Vec<AtomicRecordWrite>,
}

#[tauri::command(rename_all = "camelCase")]
async fn save_collections_atomically(
    db_instances: State<'_, DbInstances>,
    writes: Vec<AtomicCollectionWrite>,
    state_updated_at: String,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err("LOCAL_DATABASE_NOT_LOADED".into()),
    };
    drop(instances);

    let mut collection_names = HashSet::new();
    for write in &writes {
        if write.collection.trim().is_empty() || write.collection == COLLECTION_STATE {
            return Err("INVALID_COLLECTION_NAME".into());
        }
        if !collection_names.insert(write.collection.as_str()) {
            return Err("DUPLICATE_COLLECTION_WRITE".into());
        }

        let mut record_ids = HashSet::new();
        for record in &write.records {
            if record.id.trim().is_empty() {
                return Err("INVALID_RECORD_ID".into());
            }
            if !record_ids.insert(record.id.as_str()) {
                return Err("DUPLICATE_RECORD_ID".into());
            }
        }
    }

    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    for write in writes {
        sqlx::query("DELETE FROM app_records WHERE collection = ?")
            .bind(&write.collection)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;

        for record in write.records {
            sqlx::query(
                "INSERT INTO app_records (collection, id, data, updated_at) VALUES (?, ?, ?, ?)",
            )
            .bind(&write.collection)
            .bind(record.id)
            .bind(record.data)
            .bind(record.updated_at)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        }

        sqlx::query("INSERT INTO app_records (collection, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
            .bind(COLLECTION_STATE)
            .bind(&write.collection)
            .bind("{}")
            .bind(&state_updated_at)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_api_key(provider: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &provider).map_err(|e| e.to_string())?;
    if value.is_empty() {
        entry
            .delete_credential()
            .or_else(|e| match e {
                keyring::Error::NoEntry => Ok(()),
                other => Err(other),
            })
            .map_err(|e| e.to_string())
    } else {
        entry.set_password(&value).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn has_api_key(provider: String) -> Result<bool, String> {
    let entry = keyring::Entry::new(SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(!value.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuoteResult {
    price: f64,
    currency: String,
    exchange: String,
    quoted_at: String,
    is_market_open: Option<bool>,
    source: String,
}

#[tauri::command]
async fn fetch_quote(symbol: String, market: String) -> Result<QuoteResult, String> {
    let entry = keyring::Entry::new(SERVICE, "twelve-data").map_err(|e| e.to_string())?;
    let api_key = entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => "API_KEY_MISSING".to_string(),
        other => format!("KEYCHAIN_ERROR:{other}"),
    })?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let country = if market == "한국" {
        "South Korea"
    } else {
        "United States"
    };
    let response = client
        .get("https://api.twelvedata.com/quote")
        .query(&[
            ("symbol", symbol.as_str()),
            ("country", country),
            ("apikey", api_key.as_str()),
        ])
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "NETWORK_TIMEOUT".into()
            } else {
                format!("NETWORK_ERROR:{e}")
            }
        })?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "INVALID_RESPONSE".to_string())?;
    if !status.is_success() || body.get("status").and_then(|v| v.as_str()) == Some("error") {
        let message = body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("시세 API 요청에 실패했습니다");
        return Err(format!("PROVIDER_ERROR:{message}"));
    }
    let price_text = body
        .get("close")
        .or_else(|| body.get("price"))
        .and_then(|v| v.as_str())
        .ok_or("PRICE_MISSING")?;
    let price = price_text
        .parse::<f64>()
        .map_err(|_| "PRICE_INVALID".to_string())?;
    Ok(QuoteResult {
        price,
        currency: body
            .get("currency")
            .and_then(|v| v.as_str())
            .unwrap_or(if market == "한국" { "KRW" } else { "USD" })
            .to_string(),
        exchange: body
            .get("exchange")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        quoted_at: body
            .get("datetime")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        is_market_open: body.get("is_market_open").and_then(|v| v.as_bool()),
        source: "Twelve Data".into(),
    })
}

#[tauri::command]
fn write_automatic_backup(app: tauri::AppHandle, content: String) -> Result<String, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("backups");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let filename = format!("tradejournal-auto-{timestamp}.json");
    let path = directory.join(&filename);
    let temporary = directory.join(format!(".{filename}.tmp"));
    fs::write(&temporary, content.as_bytes()).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;

    let mut backups = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|entry| {
            entry
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.starts_with("tradejournal-auto-") && name.ends_with(".json")
                })
        })
        .collect::<Vec<_>>();
    backups.sort();
    let remove_count = backups.len().saturating_sub(7);
    for old in backups.into_iter().take(remove_count) {
        fs::remove_file(old).map_err(|error| error.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_local_records",
        sql: "CREATE TABLE IF NOT EXISTS app_records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id)); CREATE INDEX IF NOT EXISTS app_records_collection_idx ON app_records(collection);",
        kind: MigrationKind::Up,
    }];
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            has_api_key,
            fetch_quote,
            save_collections_atomically,
            write_automatic_backup,
            encrypt_backup,
            decrypt_backup
        ])
        .run(tauri::generate_context!())
        .expect("TradeJournal 실행 중 오류가 발생했습니다");
}

#[cfg(test)]
mod encrypted_backup_tests {
    use super::*;

    const PASSWORD: &str = "correct horse battery staple";
    const BACKUP: &str = r#"{"version":4,"stocks":[{"name":"삼성전자"}],"plans":[],"trades":[],"memo":"장기 투자 메모","amount":1200000}"#;

    #[test]
    fn encryption_round_trip_preserves_unicode_backup() {
        let encrypted = encrypt_backup(BACKUP.into(), PASSWORD.into()).unwrap();
        let decrypted = decrypt_backup(encrypted.clone(), PASSWORD.into()).unwrap();
        assert_eq!(decrypted, BACKUP);
        assert!(!encrypted.contains("삼성전자"));
        assert!(!encrypted.contains("장기 투자 메모"));
        assert!(!encrypted.contains("1200000"));
    }

    #[test]
    fn wrong_password_returns_no_plaintext() {
        let encrypted = encrypt_backup(BACKUP.into(), PASSWORD.into()).unwrap();
        assert_eq!(
            decrypt_backup(encrypted, "incorrect password".into()),
            Err("DECRYPTION_FAILED".into())
        );
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let encrypted = encrypt_backup(BACKUP.into(), PASSWORD.into()).unwrap();
        let mut parsed: EncryptedBackupContainer = serde_json::from_str(&encrypted).unwrap();
        let mut ciphertext = BASE64.decode(&parsed.ciphertext).unwrap();
        ciphertext[0] ^= 1;
        parsed.ciphertext = BASE64.encode(ciphertext);
        let tampered = serde_json::to_string(&parsed).unwrap();
        assert_eq!(
            decrypt_backup(tampered, PASSWORD.into()),
            Err("DECRYPTION_FAILED".into())
        );
    }

    #[test]
    fn tampered_salt_or_nonce_is_rejected_without_panicking() {
        for field in ["salt", "nonce"] {
            let encrypted = encrypt_backup(BACKUP.into(), PASSWORD.into()).unwrap();
            let mut parsed: EncryptedBackupContainer = serde_json::from_str(&encrypted).unwrap();
            if field == "salt" {
                let mut bytes = BASE64.decode(&parsed.kdf.salt).unwrap();
                bytes[0] ^= 1;
                parsed.kdf.salt = BASE64.encode(bytes);
            } else {
                let mut bytes = BASE64.decode(&parsed.cipher.nonce).unwrap();
                bytes[0] ^= 1;
                parsed.cipher.nonce = BASE64.encode(bytes);
            }
            assert_eq!(
                decrypt_backup(serde_json::to_string(&parsed).unwrap(), PASSWORD.into()),
                Err("DECRYPTION_FAILED".into())
            );
        }
    }

    #[test]
    fn future_container_version_is_rejected_before_decryption() {
        let encrypted = encrypt_backup(BACKUP.into(), PASSWORD.into()).unwrap();
        let mut parsed: EncryptedBackupContainer = serde_json::from_str(&encrypted).unwrap();
        parsed.format_version = 2;
        assert_eq!(
            decrypt_backup(serde_json::to_string(&parsed).unwrap(), PASSWORD.into()),
            Err("UNSUPPORTED_ENCRYPTED_BACKUP_VERSION".into())
        );
    }
}
