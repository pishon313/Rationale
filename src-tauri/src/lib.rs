use tauri_plugin_sql::{Migration, MigrationKind};
use serde::Serialize;
use std::time::Duration;

const SERVICE: &str = "com.tradejournal.local";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_local_records",
        sql: "CREATE TABLE IF NOT EXISTS app_records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id)); CREATE INDEX IF NOT EXISTS app_records_collection_idx ON app_records(collection);",
        kind: MigrationKind::Up,
    }];
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:tradejournal.db", migrations).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![save_api_key, has_api_key, fetch_quote])
        .run(tauri::generate_context!())
        .expect("TradeJournal 실행 중 오류가 발생했습니다");
}
