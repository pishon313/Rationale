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
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};
use zeroize::{Zeroize, Zeroizing};

const SERVICE: &str = "com.tradejournal.local";
const QUOTE_PROVIDER: &str = "twelve-data";
const DATABASE_URL: &str = "sqlite:tradejournal.db";
const COLLECTION_STATE: &str = "__tradejournal_collection_state__";
const ENCRYPTED_BACKUP_FORMAT: &str = "rationale-encrypted-backup";
const ENCRYPTED_BACKUP_VERSION: u8 = 1;
const ARGON2_MEMORY_COST: u32 = 65_536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 12;
const AUTOMATIC_BACKUP_PREFIX: &str = "tradejournal-auto-";
const AUTOMATIC_BACKUP_SUFFIX: &str = ".json";
const AUTOMATIC_BACKUP_INTERVAL_SECONDS: u64 = 24 * 60 * 60;
const AUTOMATIC_BACKUP_FUTURE_TOLERANCE_SECONDS: u64 = 5 * 60;
const AUTOMATIC_BACKUP_RETENTION: usize = 7;
static AUTOMATIC_BACKUP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncEnvelopeWrite {
    record_name: String,
    entity_type: String,
    logical_id: String,
    schema_version: u8,
    updated_at: String,
    deleted_at: Option<String>,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncConflictWrite {
    record_name: String,
    entity_type: String,
    logical_id: String,
    local_payload: String,
    remote_payload: String,
    detected_at: String,
    chosen_side: String,
    reason: String,
}

fn comparable_sync_envelope(serialized: &str) -> Result<serde_json::Value, String> {
    let mut value: serde_json::Value =
        serde_json::from_str(serialized).map_err(|_| "INVALID_SYNC_ENVELOPE".to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.remove("updatedAt");
        if let Some(payload) = object
            .get_mut("payload")
            .and_then(serde_json::Value::as_object_mut)
        {
            payload.remove("updatedAt");
        }
    }
    Ok(value)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorruptRecordEntry {
    quarantine_id: String,
    collection: String,
    record_id: String,
    raw_data: String,
    original_updated_at: String,
    detected_at: String,
    error_type: String,
    item_index: i64,
}

#[tauri::command]
async fn quarantine_corrupt_records(
    db_instances: State<'_, DbInstances>,
    entries: Vec<CorruptRecordEntry>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err("LOCAL_DATABASE_NOT_LOADED".into()),
    };
    drop(instances);
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| "QUARANTINE_FAILED".to_string())?;
    for entry in entries {
        if entry.quarantine_id.trim().is_empty()
            || entry.collection.trim().is_empty()
            || entry.record_id.trim().is_empty()
            || !matches!(
                entry.error_type.as_str(),
                "JSON_PARSE_ERROR" | "INVALID_RECORD"
            )
        {
            return Err("INVALID_QUARANTINE_ENTRY".into());
        }
        sqlx::query("INSERT OR IGNORE INTO corrupt_records (quarantine_id, collection, record_id, raw_data, original_updated_at, detected_at, error_type, item_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(entry.quarantine_id)
            .bind(entry.collection)
            .bind(entry.record_id)
            .bind(entry.raw_data)
            .bind(entry.original_updated_at)
            .bind(entry.detected_at)
            .bind(entry.error_type)
            .bind(entry.item_index)
            .execute(&mut *transaction)
            .await
            .map_err(|_| "QUARANTINE_FAILED".to_string())?;
    }
    transaction
        .commit()
        .await
        .map_err(|_| "QUARANTINE_FAILED".to_string())
}

#[tauri::command(rename_all = "camelCase")]
async fn save_collections_atomically(
    db_instances: State<'_, DbInstances>,
    writes: Vec<AtomicCollectionWrite>,
    state_updated_at: String,
    source: String,
    envelopes: Vec<SyncEnvelopeWrite>,
    conflicts: Vec<SyncConflictWrite>,
    acknowledged_record_names: Vec<String>,
    queued_envelopes: Vec<SyncEnvelopeWrite>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err("LOCAL_DATABASE_NOT_LOADED".into()),
    };
    drop(instances);

    if !matches!(
        source.as_str(),
        "localUser" | "remoteSync" | "backupRestore" | "sampleData" | "systemDerived"
    ) {
        return Err("INVALID_WRITE_SOURCE".into());
    }

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
    if source == "localUser" || source == "remoteSync" {
        for envelope in envelopes {
            if envelope.schema_version != 1
                || !matches!(
                    envelope.entity_type.as_str(),
                    "accounts" | "stocks" | "trades"
                )
                || envelope.record_name
                    != format!("v1|{}|{}", envelope.entity_type, envelope.logical_id)
            {
                return Err("INVALID_SYNC_ENVELOPE".into());
            }
            let serialized = serde_json::to_string(&envelope)
                .map_err(|_| "INVALID_SYNC_ENVELOPE".to_string())?;
            let previous = sqlx::query_scalar::<_, String>(
                "SELECT envelope FROM sync_record_state WHERE record_name = ?",
            )
            .bind(&envelope.record_name)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
            let changed = match previous.as_deref() {
                Some(value) => {
                    comparable_sync_envelope(value)? != comparable_sync_envelope(&serialized)?
                }
                None => true,
            };
            if source == "localUser" && changed {
                sqlx::query("INSERT INTO sync_outbox (record_name, entity_type, logical_id, operation, envelope, updated_at, queued_at) VALUES (?, ?, ?, 'upsert', ?, ?, ?) ON CONFLICT(record_name) DO UPDATE SET entity_type = excluded.entity_type, logical_id = excluded.logical_id, operation = excluded.operation, envelope = excluded.envelope, updated_at = excluded.updated_at, queued_at = excluded.queued_at")
                    .bind(&envelope.record_name).bind(&envelope.entity_type).bind(&envelope.logical_id).bind(&serialized).bind(&envelope.updated_at).bind(&state_updated_at)
                    .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
            }
            sqlx::query("INSERT INTO sync_record_state (record_name, entity_type, logical_id, envelope, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_name) DO UPDATE SET envelope = excluded.envelope, updated_at = excluded.updated_at")
                .bind(&envelope.record_name).bind(&envelope.entity_type).bind(&envelope.logical_id).bind(&serialized).bind(&envelope.updated_at)
                .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
        }
    }
    for conflict in conflicts {
        sqlx::query("INSERT INTO sync_conflicts (record_name, entity_type, logical_id, local_payload, remote_payload, detected_at, chosen_side, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(conflict.record_name).bind(conflict.entity_type).bind(conflict.logical_id).bind(conflict.local_payload).bind(conflict.remote_payload).bind(conflict.detected_at).bind(conflict.chosen_side).bind(conflict.reason)
            .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    }
    for record_name in acknowledged_record_names {
        sqlx::query("DELETE FROM sync_outbox WHERE record_name = ?")
            .bind(record_name)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
    }
    for envelope in queued_envelopes {
        if envelope.schema_version != 1
            || envelope.record_name
                != format!("v1|{}|{}", envelope.entity_type, envelope.logical_id)
        {
            return Err("INVALID_SYNC_ENVELOPE".into());
        }
        let serialized =
            serde_json::to_string(&envelope).map_err(|_| "INVALID_SYNC_ENVELOPE".to_string())?;
        sqlx::query("INSERT INTO sync_outbox (record_name, entity_type, logical_id, operation, envelope, updated_at, queued_at) VALUES (?, ?, ?, 'upsert', ?, ?, ?) ON CONFLICT(record_name) DO UPDATE SET envelope = excluded.envelope, updated_at = excluded.updated_at, queued_at = excluded.queued_at")
            .bind(&envelope.record_name).bind(&envelope.entity_type).bind(&envelope.logical_id).bind(serialized).bind(&envelope.updated_at).bind(&state_updated_at)
            .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    }
    if source == "backupRestore" {
        sqlx::query("INSERT INTO sync_settings (id, enabled, status, updated_at) VALUES ('singleton', 0, 'needsReconciliation', ?) ON CONFLICT(id) DO UPDATE SET status = 'needsReconciliation', updated_at = excluded.updated_at")
            .bind(&state_updated_at).execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncRuntimeStatus {
    enabled: bool,
    status: String,
    last_successful_sync_at: Option<String>,
    pending_outbox_count: i64,
    last_error: Option<String>,
}

#[tauri::command]
async fn get_sync_outbox(
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<serde_json::Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err("LOCAL_DATABASE_NOT_LOADED".into()),
    };
    drop(instances);
    let values = sqlx::query_scalar::<_, String>(
        "SELECT envelope FROM sync_outbox ORDER BY queued_at, record_name",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| error.to_string())?;
    values
        .into_iter()
        .map(|value| serde_json::from_str(&value).map_err(|_| "INVALID_SYNC_OUTBOX".to_string()))
        .collect()
}

#[tauri::command]
async fn get_sync_runtime_status(
    db_instances: State<'_, DbInstances>,
) -> Result<SyncRuntimeStatus, String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err("LOCAL_DATABASE_NOT_LOADED".into()),
    };
    drop(instances);
    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sync_outbox")
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let row = sqlx::query_as::<_, (i64, String, Option<String>, Option<String>)>("SELECT enabled, status, last_successful_sync_at, last_error FROM sync_settings WHERE id = 'singleton'").fetch_optional(&pool).await.map_err(|error| error.to_string())?;
    let (enabled, status, last_successful_sync_at, last_error) =
        row.unwrap_or((0, "disabled".into(), None, None));
    Ok(SyncRuntimeStatus {
        enabled: enabled != 0,
        status,
        last_successful_sync_at,
        pending_outbox_count: count,
        last_error,
    })
}

#[tauri::command(rename_all = "camelCase")]
async fn acknowledge_sync_records(
    db_instances: State<'_, DbInstances>,
    record_names: Vec<String>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => pool.clone(),
        _ => return Err("LOCAL_DATABASE_NOT_LOADED".into()),
    };
    drop(instances);
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    for record_name in record_names {
        sqlx::query("DELETE FROM sync_outbox WHERE record_name = ?")
            .bind(record_name)
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
    validate_quote_provider(&provider)?;
    if value.len() > 512 {
        return Err("INVALID_API_KEY".into());
    }
    let entry = keyring::Entry::new(SERVICE, QUOTE_PROVIDER)
        .map_err(|_| "KEYCHAIN_UNAVAILABLE".to_string())?;
    if value.is_empty() {
        entry
            .delete_credential()
            .or_else(|e| match e {
                keyring::Error::NoEntry => Ok(()),
                other => Err(other),
            })
            .map_err(|_| "KEYCHAIN_WRITE_FAILED".to_string())
    } else {
        entry
            .set_password(&value)
            .map_err(|_| "KEYCHAIN_WRITE_FAILED".to_string())
    }
}

#[tauri::command]
fn has_api_key(provider: String) -> Result<bool, String> {
    validate_quote_provider(&provider)?;
    let entry = keyring::Entry::new(SERVICE, QUOTE_PROVIDER)
        .map_err(|_| "KEYCHAIN_UNAVAILABLE".to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(!value.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("KEYCHAIN_READ_FAILED".into()),
    }
}

fn validate_quote_provider(provider: &str) -> Result<(), String> {
    if provider == QUOTE_PROVIDER {
        Ok(())
    } else {
        Err("UNSUPPORTED_API_PROVIDER".into())
    }
}

fn validate_quote_request(symbol: &str, market: &str) -> Result<(), String> {
    if symbol.trim().is_empty() || symbol.len() > 20 || symbol.chars().any(char::is_control) {
        return Err("INVALID_QUOTE_SYMBOL".into());
    }
    if !matches!(market, "한국" | "미국" | "기타") {
        return Err("INVALID_QUOTE_MARKET".into());
    }
    Ok(())
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
    validate_quote_request(&symbol, &market)?;
    let entry = keyring::Entry::new(SERVICE, QUOTE_PROVIDER)
        .map_err(|_| "KEYCHAIN_UNAVAILABLE".to_string())?;
    let api_key = entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => "API_KEY_MISSING".to_string(),
        _ => "KEYCHAIN_READ_FAILED".to_string(),
    })?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "HTTP_CLIENT_FAILED".to_string())?;
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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomaticBackupStatus {
    path: Option<String>,
    created_at_ms: Option<u64>,
    backup_needed: bool,
    created: bool,
}

struct AutomaticBackupFile {
    path: PathBuf,
    timestamp: u64,
}

#[tauri::command]
fn get_automatic_backup_status(app: tauri::AppHandle) -> Result<AutomaticBackupStatus, String> {
    let directory = automatic_backup_directory(&app)?;
    let now = unix_timestamp()?;
    automatic_backup_status(&directory, now)
}

#[tauri::command]
fn ensure_automatic_backup(
    app: tauri::AppHandle,
    content: String,
) -> Result<AutomaticBackupStatus, String> {
    let directory = automatic_backup_directory(&app)?;
    ensure_automatic_backup_in_directory(&directory, &content, unix_timestamp()?)
}

fn automatic_backup_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "AUTOMATIC_BACKUP_PATH_FAILED".to_string())?
        .join("backups"))
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "SYSTEM_TIME_INVALID".to_string())
        .map(|value| value.as_secs())
}

fn automatic_backup_status(directory: &Path, now: u64) -> Result<AutomaticBackupStatus, String> {
    let files = automatic_backup_files(directory)?;
    Ok(status_from_files(&files, now, false))
}

fn ensure_automatic_backup_in_directory(
    directory: &Path,
    content: &str,
    now: u64,
) -> Result<AutomaticBackupStatus, String> {
    let _guard = AUTOMATIC_BACKUP_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "AUTOMATIC_BACKUP_LOCK_FAILED".to_string())?;
    fs::create_dir_all(directory).map_err(|_| "AUTOMATIC_BACKUP_DIRECTORY_FAILED".to_string())?;
    let mut files = automatic_backup_files(directory)?;
    prune_automatic_backups(&mut files);
    let current = status_from_files(&files, now, false);
    if !current.backup_needed {
        return Ok(current);
    }

    let filename = format!("{AUTOMATIC_BACKUP_PREFIX}{now}{AUTOMATIC_BACKUP_SUFFIX}");
    let path = directory.join(&filename);
    let temporary = directory.join(format!(".{filename}.tmp"));
    if fs::write(&temporary, content.as_bytes()).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err("AUTOMATIC_BACKUP_WRITE_FAILED".into());
    }
    if fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err("AUTOMATIC_BACKUP_RENAME_FAILED".into());
    }
    files.push(AutomaticBackupFile {
        path: path.clone(),
        timestamp: now,
    });
    files.sort_by_key(|file| file.timestamp);
    prune_automatic_backups(&mut files);
    Ok(AutomaticBackupStatus {
        path: Some(path.to_string_lossy().into_owned()),
        created_at_ms: Some(now.saturating_mul(1_000)),
        backup_needed: false,
        created: true,
    })
}

fn automatic_backup_files(directory: &Path) -> Result<Vec<AutomaticBackupFile>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(directory)
        .map_err(|_| "AUTOMATIC_BACKUP_STATUS_FAILED".to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() {
                return None;
            }
            let name = entry.file_name();
            let name = name.to_str()?;
            let timestamp = name
                .strip_prefix(AUTOMATIC_BACKUP_PREFIX)?
                .strip_suffix(AUTOMATIC_BACKUP_SUFFIX)?
                .parse()
                .ok()?;
            Some(AutomaticBackupFile {
                path: entry.path(),
                timestamp,
            })
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|file| file.timestamp);
    Ok(files)
}

fn status_from_files(
    files: &[AutomaticBackupFile],
    now: u64,
    created: bool,
) -> AutomaticBackupStatus {
    let latest = files.iter().rev().find(|file| {
        file.timestamp <= now.saturating_add(AUTOMATIC_BACKUP_FUTURE_TOLERANCE_SECONDS)
    });
    let backup_needed = latest.is_none_or(|file| {
        file.timestamp > now
            || now.saturating_sub(file.timestamp) >= AUTOMATIC_BACKUP_INTERVAL_SECONDS
    });
    AutomaticBackupStatus {
        path: latest.map(|file| file.path.to_string_lossy().into_owned()),
        created_at_ms: latest.map(|file| file.timestamp.saturating_mul(1_000)),
        backup_needed,
        created,
    }
}

fn prune_automatic_backups(files: &mut Vec<AutomaticBackupFile>) {
    files.sort_by_key(|file| file.timestamp);
    let remove_count = files.len().saturating_sub(AUTOMATIC_BACKUP_RETENTION);
    for old in files.drain(..remove_count) {
        let _ = fs::remove_file(old.path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_local_records",
            sql: "CREATE TABLE IF NOT EXISTS app_records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id)); CREATE INDEX IF NOT EXISTS app_records_collection_idx ON app_records(collection);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_corrupt_records_quarantine",
            sql: "CREATE TABLE IF NOT EXISTS corrupt_records (quarantine_id TEXT PRIMARY KEY NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL, raw_data TEXT NOT NULL, original_updated_at TEXT NOT NULL, detected_at TEXT NOT NULL, error_type TEXT NOT NULL, item_index INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS corrupt_records_collection_idx ON corrupt_records(collection);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_sync_v1_state",
            sql: "CREATE TABLE IF NOT EXISTS sync_outbox (record_name TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, logical_id TEXT NOT NULL, operation TEXT NOT NULL, envelope TEXT NOT NULL, updated_at TEXT NOT NULL, queued_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sync_record_state (record_name TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, logical_id TEXT NOT NULL, envelope TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sync_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, record_name TEXT NOT NULL, entity_type TEXT NOT NULL, logical_id TEXT NOT NULL, local_payload TEXT NOT NULL, remote_payload TEXT NOT NULL, detected_at TEXT NOT NULL, chosen_side TEXT NOT NULL, reason TEXT NOT NULL); CREATE INDEX IF NOT EXISTS sync_conflicts_record_idx ON sync_conflicts(record_name); CREATE TABLE IF NOT EXISTS sync_settings (id TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'disabled', last_successful_sync_at TEXT, last_error TEXT, account_identifier TEXT, updated_at TEXT NOT NULL);",
            kind: MigrationKind::Up,
        },
    ];
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
            get_sync_outbox,
            get_sync_runtime_status,
            acknowledge_sync_records,
            get_automatic_backup_status,
            ensure_automatic_backup,
            encrypt_backup,
            decrypt_backup,
            quarantine_corrupt_records
        ])
        .run(tauri::generate_context!())
        .expect("TradeJournal 실행 중 오류가 발생했습니다");
}

#[cfg(test)]
mod encrypted_backup_tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Barrier,
    };

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

    #[test]
    fn ipc_quote_inputs_are_restricted_to_supported_values() {
        assert_eq!(
            validate_quote_provider("other"),
            Err("UNSUPPORTED_API_PROVIDER".into())
        );
        assert_eq!(
            validate_quote_request("", "한국"),
            Err("INVALID_QUOTE_SYMBOL".into())
        );
        assert_eq!(
            validate_quote_request("A\nB", "미국"),
            Err("INVALID_QUOTE_SYMBOL".into())
        );
        assert_eq!(
            validate_quote_request("TSLA", "unknown"),
            Err("INVALID_QUOTE_MARKET".into())
        );
        assert!(validate_quote_provider(QUOTE_PROVIDER).is_ok());
        assert!(validate_quote_request("005930", "한국").is_ok());
        assert!(validate_quote_request("BRK.B", "미국").is_ok());
    }

    fn temporary_backup_directory(label: &str) -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let path = std::env::temp_dir().join(format!(
            "rationale-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        path
    }

    fn create_backup_file(directory: &Path, timestamp: u64) {
        fs::create_dir_all(directory).unwrap();
        fs::write(
            directory.join(format!(
                "{AUTOMATIC_BACKUP_PREFIX}{timestamp}{AUTOMATIC_BACKUP_SUFFIX}"
            )),
            b"{}",
        )
        .unwrap();
    }

    #[test]
    fn automatic_backup_creates_and_reports_first_file() {
        let directory = temporary_backup_directory("first");
        let result = ensure_automatic_backup_in_directory(&directory, "backup", 10_000).unwrap();
        assert!(result.created);
        assert_eq!(result.created_at_ms, Some(10_000_000));
        assert_eq!(
            automatic_backup_status(&directory, 10_000).unwrap().path,
            result.path
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn automatic_backup_reuses_recent_file_and_replaces_old_file() {
        let directory = temporary_backup_directory("age");
        create_backup_file(&directory, 100_000);
        let recent = ensure_automatic_backup_in_directory(&directory, "new", 100_100).unwrap();
        assert!(!recent.created);
        let old = ensure_automatic_backup_in_directory(
            &directory,
            "new",
            100_000 + AUTOMATIC_BACKUP_INTERVAL_SECONDS,
        )
        .unwrap();
        assert!(old.created);
        assert_eq!(
            old.created_at_ms,
            Some((100_000 + AUTOMATIC_BACKUP_INTERVAL_SECONDS) * 1_000)
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn future_timestamp_beyond_clock_skew_does_not_block_backup() {
        let directory = temporary_backup_directory("future");
        create_backup_file(
            &directory,
            20_000 + AUTOMATIC_BACKUP_FUTURE_TOLERANCE_SECONDS + 1,
        );
        let result = ensure_automatic_backup_in_directory(&directory, "current", 20_000).unwrap();
        assert!(result.created);
        assert_eq!(result.created_at_ms, Some(20_000_000));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_write_never_becomes_successful_backup() {
        let directory = temporary_backup_directory("failure");
        fs::write(&directory, b"not a directory").unwrap();
        assert_eq!(
            ensure_automatic_backup_in_directory(&directory, "backup", 30_000),
            Err("AUTOMATIC_BACKUP_DIRECTORY_FAILED".into())
        );
        fs::remove_file(directory).unwrap();
    }

    #[test]
    fn concurrent_automatic_backup_calls_create_at_most_one_file() {
        let directory = temporary_backup_directory("concurrent");
        let barrier = Arc::new(Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let directory = directory.clone();
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    ensure_automatic_backup_in_directory(&directory, "backup", 40_000).unwrap()
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.created).count(), 1);
        assert_eq!(automatic_backup_files(&directory).unwrap().len(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn retention_keeps_seven_normal_files_and_ignores_temporary_files() {
        let directory = temporary_backup_directory("retention");
        for timestamp in 50_000..50_008 {
            create_backup_file(&directory, timestamp);
        }
        fs::write(
            directory.join(".tradejournal-auto-99999.json.tmp"),
            b"partial",
        )
        .unwrap();
        let result = ensure_automatic_backup_in_directory(&directory, "unused", 50_008).unwrap();
        assert!(!result.created);
        assert_eq!(
            automatic_backup_files(&directory).unwrap().len(),
            AUTOMATIC_BACKUP_RETENTION
        );
        assert!(directory.join(".tradejournal-auto-99999.json.tmp").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(test)]
mod sync_state_tests {
    use super::*;

    #[test]
    fn comparison_ignores_logical_timestamp_only_changes() {
        let first = r#"{"recordName":"v1|stocks|s","entityType":"stocks","logicalId":"s","schemaVersion":1,"updatedAt":"2026-01-01T00:00:00Z","deletedAt":null,"payload":{"id":"s","thesisSummary":"same","updatedAt":"2026-01-01T00:00:00Z"}}"#;
        let quote_refresh = r#"{"recordName":"v1|stocks|s","entityType":"stocks","logicalId":"s","schemaVersion":1,"updatedAt":"2026-01-02T00:00:00Z","deletedAt":null,"payload":{"id":"s","thesisSummary":"same","updatedAt":"2026-01-02T00:00:00Z"}}"#;
        assert_eq!(
            comparable_sync_envelope(first).unwrap(),
            comparable_sync_envelope(quote_refresh).unwrap()
        );
    }

    #[test]
    fn comparison_detects_user_owned_projection_changes() {
        let first = r#"{"recordName":"v1|stocks|s","entityType":"stocks","logicalId":"s","schemaVersion":1,"updatedAt":"2026-01-01T00:00:00Z","deletedAt":null,"payload":{"id":"s","thesisSummary":"first","updatedAt":"2026-01-01T00:00:00Z"}}"#;
        let changed = r#"{"recordName":"v1|stocks|s","entityType":"stocks","logicalId":"s","schemaVersion":1,"updatedAt":"2026-01-02T00:00:00Z","deletedAt":null,"payload":{"id":"s","thesisSummary":"changed","updatedAt":"2026-01-02T00:00:00Z"}}"#;
        assert_ne!(
            comparable_sync_envelope(first).unwrap(),
            comparable_sync_envelope(changed).unwrap()
        );
    }
}
