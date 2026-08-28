pub(super) use crate::service::decode_poster;

pub(super) async fn fetch_poster_bytes(client: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
    let response = client
        .get(url)
        .header("User-Agent", "MovieBox-Tui/1.0")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    Some(response.bytes().await.ok()?.to_vec())
}
