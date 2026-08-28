use std::io::Write;
use std::path::Path;

use super::check::http_client;

pub async fn download_file(url: &str, destination: &Path) -> Result<(), String> {
    if !url.starts_with("https://")
        && !url.starts_with("http://127.0.0.1")
        && !url.starts_with("http://localhost")
    {
        return Err("refusing non-https download url".to_string());
    }

    let client = http_client()?;
    let mut attempts = 0;
    let max_attempts = 3;

    loop {
        attempts += 1;
        match client.get(url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    let status = resp.status();
                    if attempts < max_attempts
                        && (status.is_server_error()
                            || status == reqwest::StatusCode::REQUEST_TIMEOUT)
                    {
                        tokio::time::sleep(std::time::Duration::from_millis(500 * attempts as u64))
                            .await;
                        continue;
                    }
                    return Err(format!("download failed with status {status}"));
                }

                let bytes = resp
                    .bytes()
                    .await
                    .map_err(|e| format!("failed to read response bytes: {e}"))?;
                let mut file = std::fs::File::create(destination)
                    .map_err(|e| format!("failed to create temp download file: {e}"))?;
                file.write_all(&bytes)
                    .map_err(|e| format!("failed to write download data: {e}"))?;
                file.flush()
                    .map_err(|e| format!("failed to flush download file: {e}"))?;
                return Ok(());
            }
            Err(e) => {
                if attempts < max_attempts {
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempts as u64))
                        .await;
                    continue;
                }
                return Err(format!("download network error: {e}"));
            }
        }
    }
}

pub async fn download_text(url: &str) -> Result<String, String> {
    if !url.starts_with("https://")
        && !url.starts_with("http://127.0.0.1")
        && !url.starts_with("http://localhost")
    {
        return Err("refusing non-https download url".to_string());
    }

    let client = http_client()?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("failed to download text: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "failed to download text, status: {}",
            resp.status()
        ));
    }

    resp.text()
        .await
        .map_err(|e| format!("failed to decode text response: {e}"))
}
