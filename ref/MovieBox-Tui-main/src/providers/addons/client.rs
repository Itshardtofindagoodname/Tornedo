use super::models::{AddonManifest, MetaDetail, MetaItem, StreamItem};
use reqwest::Client;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct AddonClient {
    http: Client,
}

impl Default for AddonClient {
    fn default() -> Self {
        Self::new()
    }
}

impl AddonClient {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(8))
            .user_agent("MovieBox-Tui/1.0 (Addon-Client)")
            .build()
            .unwrap_or_default();
        Self { http }
    }

    pub fn normalize_manifest_url(raw: &str) -> String {
        let mut url = raw.trim().to_string();
        if url.starts_with("stremio://") {
            url = format!("https://{}", &url["stremio://".len()..]);
        } else if !crate::tui::text::is_http_url(&url) {
            url = format!("https://{url}");
        }
        if !url.ends_with("/manifest.json") && !url.contains("/manifest.json?") {
            if url.ends_with('/') {
                url.push_str("manifest.json");
            } else {
                url.push_str("/manifest.json");
            }
        }
        url
    }

    pub fn base_addon_url(manifest_url: &str) -> String {
        let normalized = Self::normalize_manifest_url(manifest_url);
        if let Some(pos) = normalized.rfind("/manifest.json") {
            normalized[..pos].to_string()
        } else {
            normalized.trim_end_matches('/').to_string()
        }
    }

    pub async fn fetch_manifest(&self, manifest_url: &str) -> Result<AddonManifest, String> {
        let url = Self::normalize_manifest_url(manifest_url);
        let url_clone = url.clone();
        if let Ok(Some(cached_json)) =
            tokio::task::spawn_blocking(move || crate::cache::get_addon_manifest_cache(&url_clone))
                .await
        {
            if let Ok(manifest) = serde_json::from_value::<AddonManifest>(cached_json) {
                if !manifest.name.trim().is_empty() {
                    return Ok(manifest);
                }
            }
        }

        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to reach manifest: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Manifest returned HTTP {}", resp.status()));
        }

        let manifest: AddonManifest = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse manifest JSON: {e}"))?;

        if manifest.name.trim().is_empty() {
            return Err("Addon manifest missing valid name".to_string());
        }

        if let Ok(json_val) = serde_json::to_value(&manifest) {
            let url_clone = url.clone();
            tokio::task::spawn_blocking(move || {
                crate::cache::set_addon_manifest_cache(&url_clone, &json_val);
            });
        }

        Ok(manifest)
    }

    pub async fn fetch_catalog_search(
        &self,
        base_url: &str,
        r#type: &str,
        catalog_id: &str,
        query: &str,
    ) -> Result<Vec<MetaItem>, String> {
        let encoded_query =
            percent_encoding::utf8_percent_encode(query.trim(), percent_encoding::NON_ALPHANUMERIC)
                .to_string();

        let endpoint =
            format!("{base_url}/catalog/{type}/{catalog_id}/search={encoded_query}.json");
        let resp = self
            .http
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| format!("Catalog search request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Catalog returned HTTP {}", resp.status()));
        }

        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid catalog response JSON: {e}"))?;

        if let Some(metas_arr) = raw.get("metas").and_then(|m| m.as_array()) {
            let metas: Vec<MetaItem> =
                serde_json::from_value(serde_json::Value::Array(metas_arr.clone()))
                    .map_err(|e| format!("Failed to parse metas: {e}"))?;
            return Ok(metas);
        } else if let Some(items_arr) = raw
            .get("items")
            .or_else(|| raw.get("results"))
            .and_then(|m| m.as_array())
        {
            let metas: Vec<MetaItem> =
                serde_json::from_value(serde_json::Value::Array(items_arr.clone()))
                    .map_err(|e| format!("Failed to parse items: {e}"))?;
            return Ok(metas);
        } else if let Some(arr) = raw.as_array() {
            let metas: Vec<MetaItem> =
                serde_json::from_value(serde_json::Value::Array(arr.clone()))
                    .map_err(|e| format!("Failed to parse raw array metas: {e}"))?;
            return Ok(metas);
        }

        Ok(Vec::new())
    }

    pub async fn fetch_catalog(
        &self,
        base_url: &str,
        r#type: &str,
        catalog_id: &str,
        extra: Option<&str>,
    ) -> Result<Vec<MetaItem>, String> {
        let endpoint = if let Some(ext) = extra.filter(|s| !s.trim().is_empty()) {
            format!("{base_url}/catalog/{type}/{catalog_id}/{ext}.json")
        } else {
            format!("{base_url}/catalog/{type}/{catalog_id}.json")
        };
        let resp = self
            .http
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| format!("Catalog request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Catalog returned HTTP {}", resp.status()));
        }

        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid catalog response JSON: {e}"))?;

        if let Some(metas_arr) = raw.get("metas").and_then(|m| m.as_array()) {
            let metas: Vec<MetaItem> =
                serde_json::from_value(serde_json::Value::Array(metas_arr.clone()))
                    .map_err(|e| format!("Failed to parse metas: {e}"))?;
            return Ok(metas);
        } else if let Some(items_arr) = raw
            .get("items")
            .or_else(|| raw.get("results"))
            .and_then(|m| m.as_array())
        {
            let metas: Vec<MetaItem> =
                serde_json::from_value(serde_json::Value::Array(items_arr.clone()))
                    .map_err(|e| format!("Failed to parse items: {e}"))?;
            return Ok(metas);
        } else if let Some(arr) = raw.as_array() {
            let metas: Vec<MetaItem> =
                serde_json::from_value(serde_json::Value::Array(arr.clone()))
                    .map_err(|e| format!("Failed to parse raw array metas: {e}"))?;
            return Ok(metas);
        }

        Ok(Vec::new())
    }

    pub async fn fetch_meta(
        &self,
        base_url: &str,
        r#type: &str,
        id: &str,
    ) -> Result<MetaDetail, String> {
        let endpoint = format!("{base_url}/meta/{type}/{id}.json");
        let resp = self
            .http
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| format!("Metadata request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Metadata returned HTTP {}", resp.status()));
        }

        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid metadata response JSON: {e}"))?;

        let meta_target = if let Some(m) = raw.get("meta").filter(|m| m.is_object()) {
            m.clone()
        } else {
            raw
        };

        let detail: MetaDetail = serde_json::from_value(meta_target)
            .map_err(|e| format!("Invalid metadata detail format: {e}"))?;

        Ok(detail)
    }

    pub async fn fetch_streams(
        &self,
        base_url: &str,
        r#type: &str,
        id: &str,
    ) -> Result<Vec<StreamItem>, String> {
        let endpoint = format!("{base_url}/stream/{type}/{id}.json");
        let resp = self
            .http
            .get(&endpoint)
            .send()
            .await
            .map_err(|e| format!("Streams request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Streams returned HTTP {}", resp.status()));
        }

        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid streams response JSON: {e}"))?;

        if let Some(streams_arr) = raw.get("streams").and_then(|s| s.as_array()) {
            let streams: Vec<StreamItem> =
                serde_json::from_value(serde_json::Value::Array(streams_arr.clone()))
                    .map_err(|e| format!("Failed to parse streams: {e}"))?;
            return Ok(streams);
        } else if let Some(arr) = raw.as_array() {
            let streams: Vec<StreamItem> =
                serde_json::from_value(serde_json::Value::Array(arr.clone()))
                    .map_err(|e| format!("Failed to parse raw stream array: {e}"))?;
            return Ok(streams);
        }

        Ok(Vec::new())
    }
}
