use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::models::BrowseMetrics;
use crate::providers::Provider;
use crate::providers::bdix::circleftp::CircleFtpClient;
use crate::providers::bdix::dhakaflix::client::DhakaFlixClient;
use crate::providers::fourkhdhub::FourKHdHubClient;
use crate::providers::models::ProviderKind;
use crate::providers::moviebox::client::MovieBoxClient;

#[derive(Clone)]
pub struct MovieBoxService {
    pub client: MovieBoxClient,
    pub fourk_client: Option<FourKHdHubClient>,
    pub circleftp_client: CircleFtpClient,
    pub dhakaflix_client: DhakaFlixClient,
    pub addon_client: crate::providers::addons::AddonClient,
    pub http_client: reqwest::Client,
}

impl Default for MovieBoxService {
    fn default() -> Self {
        Self::new()
    }
}

impl MovieBoxService {
    pub fn new() -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        Self {
            client: MovieBoxClient::new(),
            fourk_client: FourKHdHubClient::new().ok(),
            circleftp_client: CircleFtpClient::new(),
            dhakaflix_client: DhakaFlixClient::new(),
            addon_client: crate::providers::addons::AddonClient::new(),
            http_client,
        }
    }

    pub fn http_client(&self) -> &reqwest::Client {
        &self.http_client
    }

    pub fn capabilities(&self, provider: ProviderKind) -> crate::providers::ProviderCapabilities {
        match provider {
            ProviderKind::MovieBox => Provider::capabilities(&self.client),
            ProviderKind::FourKHdHub => self
                .fourk_client
                .as_ref()
                .map(Provider::capabilities)
                .unwrap_or_default(),
            ProviderKind::BdixCircleFtp => Provider::capabilities(&self.circleftp_client),
            ProviderKind::BdixDhakaFlix => Provider::capabilities(&self.dhakaflix_client),
            ProviderKind::Addons => Provider::capabilities(&self.addon_client),
        }
    }

    pub async fn suggest(&self, query: &str) -> Result<serde_json::Value, String> {
        self.client.suggest(query).await.map_err(|e| e.to_string())
    }

    pub async fn search(
        &self,
        provider: ProviderKind,
        query: &str,
        page: usize,
    ) -> Result<serde_json::Value, String> {
        match provider {
            ProviderKind::MovieBox => Provider::search(&self.client, query, page).await,
            ProviderKind::FourKHdHub => {
                let fourk = self
                    .fourk_client
                    .as_ref()
                    .ok_or_else(|| "4KHDHub provider is unavailable".to_string())?;
                Provider::search(fourk, query, page).await
            }
            ProviderKind::BdixCircleFtp => {
                Provider::search(&self.circleftp_client, query, page).await
            }
            ProviderKind::BdixDhakaFlix => {
                Provider::search(&self.dhakaflix_client, query, page).await
            }
            ProviderKind::Addons => {
                let addons = crate::config::load_addons();
                let catalog_addons: Vec<_> = addons
                    .iter()
                    .filter(|a| a.enabled && (a.provides_meta || a.provides_catalog))
                    .collect();

                if catalog_addons.is_empty() {
                    return Err(
                        "No catalog/metadata addon enabled. Open /config to configure one."
                            .to_string(),
                    );
                }

                let mut combined = Vec::new();
                for addon in catalog_addons {
                    let base_url =
                        crate::providers::addons::AddonClient::base_addon_url(&addon.manifest_url);
                    if let Ok(movies) = self
                        .addon_client
                        .fetch_catalog_search(&base_url, "movie", "top", query)
                        .await
                    {
                        combined.extend(movies);
                    }
                    if let Ok(series) = self
                        .addon_client
                        .fetch_catalog_search(&base_url, "series", "top", query)
                        .await
                    {
                        combined.extend(series);
                    }
                    if !combined.is_empty() {
                        break;
                    }
                }

                if combined.is_empty() {
                    return Err(format!("No matches found for '{query}'."));
                }

                Ok(crate::providers::addons::adapter::metas_to_moviebox_search_json(combined))
            }
        }
    }

    pub async fn fetch_addon_catalog(
        &self,
        manifest_url: &str,
        r#type: &str,
        catalog_id: &str,
    ) -> Result<serde_json::Value, String> {
        let manifest_clone = manifest_url.to_string();
        let type_clone = r#type.to_string();
        let cat_id_clone = catalog_id.to_string();
        if let Ok(Some(cached)) = tokio::task::spawn_blocking(move || {
            crate::cache::get_addon_catalog_cache(&manifest_clone, &type_clone, &cat_id_clone)
        })
        .await
        {
            return Ok(cached);
        }

        let base_url = crate::providers::addons::AddonClient::base_addon_url(manifest_url);
        let metas = self
            .addon_client
            .fetch_catalog(&base_url, r#type, catalog_id, None)
            .await
            .map_err(|e| e.to_string())?;

        if metas.is_empty() {
            return Err("No catalog items found".to_string());
        }

        let json = crate::providers::addons::adapter::metas_to_moviebox_search_json(metas);
        let manifest_clone = manifest_url.to_string();
        let type_clone = r#type.to_string();
        let cat_id_clone = catalog_id.to_string();
        let json_clone = json.clone();
        tokio::task::spawn_blocking(move || {
            crate::cache::set_addon_catalog_cache(
                &manifest_clone,
                &type_clone,
                &cat_id_clone,
                &json_clone,
            );
        });
        Ok(json)
    }

    pub async fn details(
        &self,
        provider: ProviderKind,
        subject_id: &str,
    ) -> Result<serde_json::Value, String> {
        match provider {
            ProviderKind::MovieBox => Provider::details(&self.client, subject_id).await,
            ProviderKind::FourKHdHub => {
                let fourk = self
                    .fourk_client
                    .as_ref()
                    .ok_or_else(|| "4KHDHub provider is unavailable".to_string())?;
                Provider::details(fourk, subject_id).await
            }
            ProviderKind::BdixCircleFtp => {
                Provider::details(&self.circleftp_client, subject_id).await
            }
            ProviderKind::BdixDhakaFlix => {
                Provider::details(&self.dhakaflix_client, subject_id).await
            }
            ProviderKind::Addons => {
                let addons = crate::config::load_addons();
                let meta_addons: Vec<_> = addons
                    .iter()
                    .filter(|a| a.enabled && a.provides_meta)
                    .collect();

                let types_to_try = ["series", "tv", "anime", "movie", "other"];
                let mut best_detail: Option<crate::providers::addons::models::MetaDetail> = None;

                for addon in &meta_addons {
                    let base_url =
                        crate::providers::addons::AddonClient::base_addon_url(&addon.manifest_url);
                    for t in types_to_try {
                        if let Ok(d) = self.addon_client.fetch_meta(&base_url, t, subject_id).await
                        {
                            if !d.videos.is_empty()
                                || d.r#type.eq_ignore_ascii_case("series")
                                || d.r#type.eq_ignore_ascii_case("tv")
                            {
                                return Ok(
                                    crate::providers::addons::adapter::meta_detail_to_moviebox_json(
                                        &d,
                                    ),
                                );
                            }
                            if best_detail.is_none() {
                                best_detail = Some(d);
                            }
                        }
                    }
                }

                for addon in &addons {
                    if addon.enabled
                        && !meta_addons
                            .iter()
                            .any(|m| m.manifest_url == addon.manifest_url)
                    {
                        let base_url = crate::providers::addons::AddonClient::base_addon_url(
                            &addon.manifest_url,
                        );
                        for t in types_to_try {
                            if let Ok(d) =
                                self.addon_client.fetch_meta(&base_url, t, subject_id).await
                            {
                                if !d.videos.is_empty()
                                    || d.r#type.eq_ignore_ascii_case("series")
                                    || d.r#type.eq_ignore_ascii_case("tv")
                                {
                                    return Ok(
                                        crate::providers::addons::adapter::meta_detail_to_moviebox_json(&d),
                                    );
                                }
                                if best_detail.is_none() {
                                    best_detail = Some(d);
                                }
                            }
                        }
                    }
                }

                if let Some(d) = best_detail {
                    return Ok(crate::providers::addons::adapter::meta_detail_to_moviebox_json(&d));
                }

                Err(format!("Could not fetch metadata for ID '{subject_id}'."))
            }
        }
    }

    pub async fn homepage(&self, tab_id: &str, page: usize) -> Result<serde_json::Value, String> {
        self.client
            .get_homepage(tab_id, page)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn fetch_collection_resolutions(&self, subject_id: &str) -> Result<Vec<u32>, String> {
        self.client
            .fetch_collection_resolutions(subject_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_ext_captions(
        &self,
        subject_id: &str,
        resource_id: &str,
    ) -> Result<serde_json::Value, String> {
        self.client
            .get_ext_captions(subject_id, resource_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn fetch_poster_bytes(&self, url: &str) -> Option<Vec<u8>> {
        let response = self
            .http_client
            .get(url)
            .header("User-Agent", "MovieBox-Tui/1.0")
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        Some(response.bytes().await.ok()?.to_vec())
    }

    pub async fn download_subtitle_file(
        &self,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<PathBuf, String> {
        let mut request = self.http_client.get(url);
        for (name, value) in headers {
            request = request.header(name.as_str(), value.as_str());
        }

        let response = tokio::time::timeout(std::time::Duration::from_secs(8), request.send())
            .await
            .map_err(|_| "Subtitle download timed out".to_string())?
            .map_err(|e| format!("Failed to request subtitle: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Subtitle response status error: {e}"))?;

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read subtitle bytes: {e}"))?;

        let extension = url
            .rsplit('.')
            .next()
            .map(|e| e.to_ascii_lowercase())
            .filter(|e| matches!(e.as_str(), "srt" | "vtt" | "ass" | "ssa" | "sub"))
            .unwrap_or_else(|| "srt".to_string());

        let base_dir = resolve_subtitle_dir();
        let _ = std::fs::create_dir_all(&base_dir);

        let path = base_dir.join(format!(
            "{}_{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            extension
        ));

        tokio::fs::write(&path, bytes)
            .await
            .map_err(|e| format!("Failed to write subtitle file: {e}"))?;

        Ok(path)
    }
}

pub async fn decode_poster(bytes: Vec<u8>) -> Option<Arc<image::DynamicImage>> {
    tokio::task::spawn_blocking(move || image::load_from_memory(&bytes))
        .await
        .ok()?
        .ok()
        .map(Arc::new)
}

pub fn extract_cover_url(val: &serde_json::Value) -> Option<String> {
    let keys = [
        "cover",
        "poster",
        "pic",
        "coverUrl",
        "cover_url",
        "posterUrl",
        "poster_url",
        "thumbnail",
        "image",
        "logo",
        "imgUrl",
        "img_url",
    ];
    for key in keys {
        if let Some(v) = val.get(key) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            } else if let Some(url) = v.get("url").and_then(|u| u.as_str()) {
                if !url.is_empty() {
                    return Some(url.to_string());
                }
            }
        }
    }
    None
}

pub fn metric_value(item: &serde_json::Value, keys: &[&str]) -> Option<f64> {
    let mut containers = vec![item];
    if let Some(metadata) = item.get("metadata") {
        containers.push(metadata);
    }
    if let Some(meta) = item.get("meta") {
        containers.push(meta);
    }

    containers.into_iter().find_map(|container| {
        keys.iter().find_map(|key| {
            let value = container.get(*key)?;
            value
                .as_f64()
                .or_else(|| value.as_i64().map(|number| number as f64))
                .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
        })
    })
}

pub fn extract_browse_metrics(item: &serde_json::Value) -> BrowseMetrics {
    BrowseMetrics {
        trending: metric_value(
            item,
            &["__browse_rank", "imdb_trending", "imdbTrending", "trending"],
        ),
        rating: metric_value(
            item,
            &["imdbRatingValue", "imdbRate", "imdb_rating", "imdbRating"],
        ),
        recent_rating: metric_value(
            item,
            &[
                "imdb_rating_30d",
                "imdbRating30Days",
                "imdbRatingLast30Days",
                "imdb_rating_recent",
                "imdbRatingValue",
                "imdbRate",
            ],
        ),
        popularity: metric_value(
            item,
            &[
                "__browse_rank",
                "imdb_popularity",
                "imdbPopularity",
                "popularity",
                "viewers",
            ],
        ),
    }
}

pub fn subject_id(value: &serde_json::Value) -> Option<String> {
    value
        .as_i64()
        .map(|n| n.to_string())
        .or_else(|| value.as_str().map(|s| s.to_string()))
}

pub fn stype(value: &serde_json::Value) -> i64 {
    value
        .get("subjectType")
        .and_then(|s| s.as_i64())
        .or_else(|| value.get("stype").and_then(|s| s.as_i64()))
        .unwrap_or(1)
}

pub fn caption_options(payload: &serde_json::Value) -> Vec<(String, String)> {
    let mut options = vec![("None".to_string(), "".to_string())];
    options.extend(
        crate::providers::moviebox::adapt::captions_json_to_options(payload)
            .into_iter()
            .map(|subtitle| (subtitle.name, subtitle.url)),
    );
    options
}

pub fn caption_url_for(payload: &serde_json::Value, language: &str) -> Option<String> {
    crate::providers::moviebox::adapt::captions_json_to_options(payload)
        .into_iter()
        .find(|subtitle| subtitle.name == language)
        .map(|subtitle| subtitle.url)
}

pub fn resolve_subtitle_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        let storage = home.join("storage/downloads/moviebox_subs");
        if home.join("storage/downloads").exists() {
            let _ = std::fs::create_dir_all(&storage);
            return storage;
        }
    }
    crate::config::cache_dir().join("subs")
}

pub fn ensure_moviebox_subdir(path: &Path) -> PathBuf {
    let is_already_mb = path
        .file_name()
        .map(|name| {
            let s = name.to_string_lossy();
            s.eq_ignore_ascii_case("MovieBox-TUI") || s.eq_ignore_ascii_case("MovieBox")
        })
        .unwrap_or(false);

    if is_already_mb {
        path.to_path_buf()
    } else {
        path.join("MovieBox-TUI")
    }
}

pub fn resolve_download_dir(custom_dir: Option<&Path>) -> PathBuf {
    if let Some(custom) = custom_dir {
        if std::fs::create_dir_all(custom).is_ok() {
            let probe = custom.join(format!(".mb_probe_{}", std::process::id()));
            if std::fs::write(&probe, b"ok").is_ok() {
                let _ = std::fs::remove_file(&probe);
                return ensure_moviebox_subdir(custom);
            }
        }
    }

    let base_dir = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| PathBuf::from("."));

    if let Some(home) = dirs::home_dir() {
        let android_storage = home.join("storage/downloads");
        if android_storage.exists() {
            return ensure_moviebox_subdir(&android_storage);
        }
    }

    ensure_moviebox_subdir(&base_dir)
}
