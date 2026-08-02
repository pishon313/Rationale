use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

const SERVICE: &str = "com.tradejournal.local";
const DATABASE_URL: &str = "sqlite:tradejournal.db";
const COLLECTION_STATE: &str = "__tradejournal_collection_state__";

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
            sqlx::query("INSERT INTO app_records (collection, id, data, updated_at) VALUES (?, ?, ?, ?)")
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
    transaction.commit().await.map_err(|error| error.to_string())
}

#[tauri::command]
fn save_api_key(provider: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &provider).map_err(|e| e.to_string())?;
    if value.is_empty() { entry.delete_credential().or_else(|e| match e { keyring::Error::NoEntry => Ok(()), other => Err(other) }).map_err(|e| e.to_string()) }
    else { entry.set_password(&value).map_err(|e| e.to_string()) }
}

#[tauri::command]
fn has_api_key(provider: String) -> Result<bool, String> {
    let entry = keyring::Entry::new(SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.get_password() { Ok(value) => Ok(!value.is_empty()), Err(keyring::Error::NoEntry) => Ok(false), Err(e) => Err(e.to_string()) }
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
    let client = reqwest::Client::builder().timeout(Duration::from_secs(12)).build().map_err(|e| e.to_string())?;
    let country = if market == "한국" { "South Korea" } else { "United States" };
    let response = client.get("https://api.twelvedata.com/quote")
        .query(&[("symbol", symbol.as_str()), ("country", country), ("apikey", api_key.as_str())])
        .send().await.map_err(|e| if e.is_timeout() { "NETWORK_TIMEOUT".into() } else { format!("NETWORK_ERROR:{e}") })?;
    let status = response.status();
    let body: serde_json::Value = response.json().await.map_err(|_| "INVALID_RESPONSE".to_string())?;
    if !status.is_success() || body.get("status").and_then(|v| v.as_str()) == Some("error") {
        let message = body.get("message").and_then(|v| v.as_str()).unwrap_or("시세 API 요청에 실패했습니다");
        return Err(format!("PROVIDER_ERROR:{message}"));
    }
    let price_text = body.get("close").or_else(|| body.get("price")).and_then(|v| v.as_str()).ok_or("PRICE_MISSING")?;
    let price = price_text.parse::<f64>().map_err(|_| "PRICE_INVALID".to_string())?;
    Ok(QuoteResult {
        price,
        currency: body.get("currency").and_then(|v| v.as_str()).unwrap_or(if market == "한국" { "KRW" } else { "USD" }).to_string(),
        exchange: body.get("exchange").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        quoted_at: body.get("datetime").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        is_market_open: body.get("is_market_open").and_then(|v| v.as_bool()),
        source: "Twelve Data".into(),
    })
}

#[tauri::command]
fn write_automatic_backup(app: tauri::AppHandle, content: String) -> Result<String, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?.join("backups");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_secs();
    let filename = format!("tradejournal-auto-{timestamp}.json");
    let path = directory.join(&filename);
    let temporary = directory.join(format!(".{filename}.tmp"));
    fs::write(&temporary, content.as_bytes()).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;

    let mut backups = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|entry| entry.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("tradejournal-auto-") && name.ends_with(".json")))
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
        .plugin(tauri_plugin_sql::Builder::default().add_migrations(DATABASE_URL, migrations).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_api_key, has_api_key, fetch_quote, save_collections_atomically, write_automatic_backup])
        .run(tauri::generate_context!())
        .expect("TradeJournal 실행 중 오류가 발생했습니다");
}
