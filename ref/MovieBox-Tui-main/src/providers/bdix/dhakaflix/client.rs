use reqwest::Client;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use thiserror::Error;

use crate::providers::models::{
    CatalogItem, MediaDetails, MediaType, ProviderKind, ProviderMediaId, Release,
};

#[derive(Debug, Error)]
pub enum DhakaFlixError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

fn parse_title_and_year(raw_title: &str) -> (String, Option<String>) {
    let mut title = raw_title.to_string();
    let mut year = None;

    if let Some(start) = title.rfind('(') {
        if let Some(end) = title[start..].find(')') {
            let year_str = &title[start + 1..start + end];
            if year_str.len() == 4 && year_str.chars().all(|c| c.is_ascii_digit()) {
                year = Some(year_str.to_string());
                title = title[..start].trim().to_string();
                return (title, year);
            }
        }
    }

    let lower = title.to_lowercase();
    let qualities = [
        " 1080p", " 720p", " 480p", " 2160p", " 4k", " hd", " hdrip", " webrip", " hdcam",
    ];
    for q in qualities {
        if lower.ends_with(q) {
            title = title[..title.len() - q.len()].trim().to_string();
            break;
        }
    }

    (title, year)
}

fn quality_score(name: &str) -> u8 {
    let lower = name.to_lowercase();
    if lower.contains("2160p") || lower.contains("4k") {
        3
    } else if lower.contains("1080p") {
        2
    } else if lower.contains("720p") {
        1
    } else {
        0
    }
}

const SERVERS: &[(&str, &str)] = &[
    ("http://172.16.50.7", "/DHAKA-FLIX-7/"),
    ("http://172.16.50.14", "/DHAKA-FLIX-14/"),
    ("http://172.16.50.12", "/DHAKA-FLIX-12/"),
    ("http://172.16.50.9", "/DHAKA-FLIX-9/"),
];

const DEAD_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct DhakaFlixClient {
    client: Client,
    recent_fails: Arc<RwLock<HashMap<String, Instant>>>,
}

impl Default for DhakaFlixClient {
    fn default() -> Self {
        Self::new()
    }
}

impl DhakaFlixClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            recent_fails: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn healthy_servers(&self) -> Vec<(&'static str, &'static str)> {
        let fails = self.recent_fails.read().unwrap_or_else(|e| e.into_inner());
        let mut out = Vec::new();
        for (base, path) in SERVERS {
            if fails
                .get(*base)
                .is_none_or(|failed| failed.elapsed() >= DEAD_TTL)
            {
                out.push((*base, *path));
            }
        }
        out
    }

    fn dedup_best_quality(results: Vec<(CatalogItem, u8)>) -> Vec<CatalogItem> {
        let mut best: HashMap<(String, Option<String>), (CatalogItem, u8)> = HashMap::new();
        for (item, quality) in results {
            let key = (item.title.to_lowercase(), item.year.clone());
            match best.get(&key) {
                Some((_, existing)) if *existing >= quality => {}
                _ => {
                    best.insert(key, (item, quality));
                }
            }
        }
        let mut out: Vec<CatalogItem> = best.into_values().map(|(item, _)| item).collect();
        out.sort_by_key(|item| item.title.to_lowercase());
        out
    }

    pub async fn search(&self, query: &str) -> Result<Vec<CatalogItem>, DhakaFlixError> {
        let servers = self.healthy_servers();
        let mut futures = Vec::new();
        for (base_url, href) in servers {
            let url = format!("{}{}", base_url, href);
            let body = json!({
                "action": "get",
                "search": {
                    "href": href,
                    "pattern": query,
                    "ignorecase": true
                }
            });
            let client = self.client.clone();
            let recent_fails = self.recent_fails.clone();

            futures.push(async move {
                let mut server_results: Vec<(CatalogItem, u8)> = Vec::new();
                match client.post(&url).json(&body).send().await {
                    Ok(resp) => {
                        if let Ok(text) = resp.text().await {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                                if let Some(search_arr) =
                                    json.get("search").and_then(|v| v.as_array())
                                {
                                    for item in search_arr {
                                        if let Some(item_href) =
                                            item.get("href").and_then(|v| v.as_str())
                                        {
                                            let is_dir = item_href.ends_with('/');
                                            let mut parts: Vec<&str> = item_href
                                                .split('/')
                                                .filter(|p| !p.is_empty())
                                                .collect();

                                            if !is_dir && parts.len() > 1 {
                                                parts.pop();
                                            }

                                            let folder_path = format!("/{}/", parts.join("/"));

                                            if let Some(name) = parts.last() {
                                                let name_decoded =
                                                    percent_encoding::percent_decode_str(name)
                                                        .decode_utf8_lossy()
                                                        .to_string();
                                                let quality = quality_score(&name_decoded);
                                                let (clean_title, year) =
                                                    parse_title_and_year(&name_decoded);

                                                server_results.push((
                                                    CatalogItem {
                                                        id: ProviderMediaId {
                                                            provider: ProviderKind::BdixDhakaFlix,
                                                            value: format!(
                                                                "{}:{}{}",
                                                                base_url,
                                                                href,
                                                                folder_path
                                                                    .trim_start_matches(href)
                                                            ),
                                                        },
                                                        title: clean_title,
                                                        year,
                                                        media_type: MediaType::Movie,
                                                        poster_url: None,
                                                        season_count: None,
                                                    },
                                                    quality,
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(error) => {
                        log::warn!(
                            "dhakaflix search request failed: {error} [{}]",
                            crate::logging::sanitize_url(base_url)
                        );
                        if let Ok(mut fails) = recent_fails.write() {
                            fails.insert(base_url.to_string(), Instant::now());
                        }
                    }
                }
                server_results
            });
        }

        let results_array = futures::future::join_all(futures).await;
        let all_results: Vec<(CatalogItem, u8)> = results_array.into_iter().flatten().collect();
        let mut all_results = Self::dedup_best_quality(all_results);

        let mut poster_futures = Vec::new();
        for item in &all_results {
            let client = self.client.clone();
            let id = item.id.value.clone();

            poster_futures.push(async move {
                let parts: Vec<&str> = id.split(':').collect();
                if parts.len() >= 3 {
                    let base_url = parts[0..2].join(":");
                    let path = parts[2..].join(":");
                    let path_parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
                    if !path_parts.is_empty() {
                        let api_href = format!("/{}/", path_parts[0]);
                        let api_url = format!("{}{}", base_url, api_href);

                        let body = json!({
                            "action": "get",
                            "items": {
                                "href": path,
                                "what": 1
                            }
                        });

                        if let Ok(resp) = client.post(&api_url).json(&body).send().await {
                            if let Ok(json) = resp.json::<serde_json::Value>().await {
                                if let Some(items) = json.get("items").and_then(|v| v.as_array()) {
                                    for file in items {
                                        if let Some(href) =
                                            file.get("href").and_then(|v| v.as_str())
                                        {
                                            let href_lower = href.to_lowercase();
                                            if href_lower.ends_with(".jpg")
                                                || href_lower.ends_with(".jpeg")
                                                || href_lower.ends_with(".png")
                                            {
                                                return Some(format!("{}{}", base_url, href));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                None
            });
        }

        let posters = futures::future::join_all(poster_futures).await;
        for (item, poster) in all_results.iter_mut().zip(posters) {
            item.poster_url = poster;
        }

        Ok(all_results)
    }

    pub async fn details(&self, id: &str) -> Result<MediaDetails, DhakaFlixError> {
        let parts: Vec<&str> = id.split(':').collect();
        let mut title = "Unknown".to_string();
        if parts.len() >= 3 {
            let path = parts[2..].join(":");
            let path_parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            if let Some(name) = path_parts.last() {
                title = percent_encoding::percent_decode_str(name)
                    .decode_utf8_lossy()
                    .to_string();
            }
        }

        let (clean_title, year) = parse_title_and_year(&title);

        Ok(MediaDetails {
            id: ProviderMediaId {
                provider: ProviderKind::BdixDhakaFlix,
                value: id.to_string(),
            },
            title: clean_title,
            media_type: MediaType::Movie,
            year,
            description: None,
            tagline: None,
            imdb_rating: None,
            director: None,
            stars: None,
            prints: None,
            audios: None,
            poster_url: None,
            duration: None,
            genres: vec![],
            seasons: vec![],
        })
    }

    pub async fn streams(&self, id: &str) -> Result<Vec<Release>, DhakaFlixError> {
        let mut releases = Vec::new();

        let parts: Vec<&str> = id.split(':').collect();
        if parts.len() < 3 {
            return Ok(releases);
        }

        let base_url = parts[0..2].join(":");
        let path = parts[2..].join(":");
        let path_parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();

        if path_parts.last().is_some() {
            let mut api_href = "/";
            for (s_base, s_href) in SERVERS {
                if base_url == *s_base {
                    api_href = *s_href;
                    break;
                }
            }

            let api_url = format!("{}{}", base_url, api_href);
            let body = json!({
                "action": "get",
                "items": {
                    "href": path,
                    "what": 1
                }
            });

            if let Ok(resp) = self.client.post(&api_url).json(&body).send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(items_arr) = json.get("items").and_then(|v| v.as_array()) {
                        for item in items_arr {
                            if let (Some(item_href), Some(size)) = (
                                item.get("href").and_then(|v| v.as_str()),
                                item.get("size").and_then(|v| v.as_u64()),
                            ) {
                                let filename = item_href
                                    .split('/')
                                    .next_back()
                                    .unwrap_or("Unknown")
                                    .to_string();
                                let filename_decoded =
                                    percent_encoding::percent_decode_str(&filename)
                                        .decode_utf8_lossy()
                                        .to_string();

                                let f_lower = filename_decoded.to_lowercase();
                                if !f_lower.ends_with(".mkv")
                                    && !f_lower.ends_with(".mp4")
                                    && !f_lower.ends_with(".avi")
                                    && !f_lower.ends_with(".webm")
                                {
                                    continue;
                                }

                                let quality = if f_lower.contains("1080p") {
                                    Some("1080p".to_string())
                                } else if filename_decoded.to_lowercase().contains("720p") {
                                    Some("720p".to_string())
                                } else if filename_decoded.to_lowercase().contains("2160p")
                                    || filename_decoded.to_lowercase().contains("4k")
                                {
                                    Some("4K".to_string())
                                } else {
                                    Some("HD".to_string())
                                };

                                let mut language = None;
                                let mut codec = None;

                                if f_lower.contains("hindi") {
                                    language = Some("Hindi".to_string());
                                } else if f_lower.contains("bengali") || f_lower.contains("bangla")
                                {
                                    language = Some("Bengali".to_string());
                                } else if f_lower.contains("tamil") {
                                    language = Some("Tamil".to_string());
                                } else if f_lower.contains("telugu") {
                                    language = Some("Telugu".to_string());
                                } else if f_lower.contains("dual") {
                                    language = Some("Dual Audio".to_string());
                                } else if f_lower.contains("multi") {
                                    language = Some("Multi Audio".to_string());
                                } else if f_lower.contains("english") {
                                    language = Some("English".to_string());
                                }

                                if f_lower.contains("hevc") || f_lower.contains("x265") {
                                    codec = Some("HEVC".to_string());
                                } else if f_lower.contains("x264") || f_lower.contains("h264") {
                                    codec = Some("x264".to_string());
                                } else if f_lower.contains("av1") {
                                    codec = Some("AV1".to_string());
                                }

                                releases.push(Release {
                                    provider: ProviderKind::BdixDhakaFlix,
                                    filename: filename_decoded,
                                    quality,
                                    codec,
                                    language,
                                    size_bytes: Some(size),
                                    season: None,
                                    episode: None,
                                    mirrors: vec![crate::providers::models::SourceMirror {
                                        label: "DhakaFlix".to_string(),
                                        resolver_url: format!("{}{}", base_url, item_href),
                                        headers: vec![],
                                        direct_file: true,
                                    }],
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(releases)
    }

    pub async fn resolve_release(&self, resolver_url: &str) -> Result<String, DhakaFlixError> {
        Ok(resolver_url.to_string())
    }
}
