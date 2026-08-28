use std::time::Duration;
use thiserror::Error;

use crate::providers::models::{
    CatalogItem, Episode, MediaDetails, MediaType, ProviderKind, ProviderMediaId, Release, Season,
    SourceMirror,
};

use super::parser::{CircleFtpSearchResponse, circleftp_search_to_catalog};

#[derive(Debug, Error)]
pub enum CircleFtpError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

#[derive(Clone)]
pub struct CircleFtpClient {
    client: reqwest::Client,
    base_url: String,
}

impl Default for CircleFtpClient {
    fn default() -> Self {
        Self::new()
    }
}

impl CircleFtpClient {
    pub fn new() -> Self {
        Self {
            client: build_client(),
            base_url: "http://new.circleftp.net:5000/api".to_string(),
        }
    }

    pub async fn search(&self, query: &str) -> Result<Vec<CatalogItem>, CircleFtpError> {
        let mut url = reqwest::Url::parse(&format!("{}/posts", self.base_url))
            .map_err(|e| CircleFtpError::Parse(e.to_string()))?;
        url.query_pairs_mut()
            .append_pair("searchTerm", query)
            .append_pair("order", "desc");

        let resp = self.client.get(url).send().await?;

        let search_resp: CircleFtpSearchResponse = resp.json().await?;
        Ok(circleftp_search_to_catalog(&search_resp))
    }

    pub async fn details(&self, id: &str) -> Result<MediaDetails, CircleFtpError> {
        let url = format!("{}/posts/{}", self.base_url, id);
        let resp = self.client.get(&url).send().await?;
        let json: serde_json::Value = resp.json().await?;

        let title = json
            .get("title")
            .or(json.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let r#type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let media_type = if r#type == "series" {
            MediaType::Series
        } else {
            MediaType::Movie
        };
        let year = json.get("year").and_then(|v| {
            if v.is_number() {
                Some(v.to_string())
            } else {
                v.as_str().map(|s| s.to_string())
            }
        });

        let poster_url = json
            .get("image")
            .or(json.get("imageSm"))
            .and_then(|v| v.as_str())
            .map(|s| format!("http://new.circleftp.net:5000/uploads/{}", s));

        let mut seasons = Vec::new();
        if media_type == MediaType::Series {
            if let Some(content) = json.get("content").and_then(|v| v.as_array()) {
                for (s_idx, s_val) in content.iter().enumerate() {
                    let mut episodes = Vec::new();
                    if let Some(ep_arr) = s_val.get("episodes").and_then(|v| v.as_array()) {
                        for (e_idx, e_val) in ep_arr.iter().enumerate() {
                            let ep_title = e_val
                                .get("title")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            episodes.push(Episode {
                                season: s_idx + 1,
                                number: e_idx + 1,
                                title: ep_title,
                            });
                        }
                    }
                    seasons.push(Season {
                        number: s_idx + 1,
                        episodes,
                    });
                }
            }
        }

        let description = json
            .get("metaData")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let duration = json
            .get("watchTime")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut genres = Vec::new();
        if let Some(cats) = json.get("categories").and_then(|v| v.as_array()) {
            for cat in cats {
                if let Some(name) = cat.get("name").and_then(|v| v.as_str()) {
                    genres.push(name.to_string());
                }
            }
        }

        let title_full = json.get("title").and_then(|v| v.as_str()).unwrap_or("");

        let t_lower = title_full.to_lowercase();

        let audios = [
            ("hindi", "Hindi"),
            ("bengali", "Bengali"),
            ("bangla", "Bengali"),
            ("english", "English"),
            ("tamil", "Tamil"),
            ("telugu", "Telugu"),
            ("malayalam", "Malayalam"),
            ("korean", "Korean"),
            ("dual audio", "Dual Audio"),
            ("multi audio", "Multi Audio"),
        ]
        .iter()
        .find(|(k, _)| t_lower.contains(k))
        .map(|(_, v)| v.to_string());

        let prints = [
            ("cam", "CAM"),
            ("hdcam", "CAM"),
            ("hdtc", "HDTC"),
            ("tc", "HDTC"),
            ("hdrip", "HDRip"),
            ("hd rip", "HDRip"),
            ("webrip", "WEBRip"),
            ("web-rip", "WEBRip"),
            ("webdl", "WEB-DL"),
            ("web-dl", "WEB-DL"),
            ("bluray", "BluRay"),
            ("brrip", "BluRay"),
        ]
        .iter()
        .find(|(k, _)| t_lower.contains(k))
        .map(|(_, v)| v.to_string());

        Ok(MediaDetails {
            id: ProviderMediaId {
                provider: ProviderKind::BdixCircleFtp,
                value: id.to_string(),
            },
            title,
            media_type,
            year,
            description,
            tagline: None,
            imdb_rating: None,
            director: None,
            stars: None,
            prints,
            audios,
            poster_url,
            duration,
            genres,
            seasons,
        })
    }

    async fn fetch_size(&self, link: &str) -> Option<u64> {
        self.client
            .head(link)
            .send()
            .await
            .ok()?
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)?
            .to_str()
            .ok()?
            .parse::<u64>()
            .ok()
    }

    pub async fn releases(
        &self,
        id: &str,
        season: Option<usize>,
        episode: Option<usize>,
    ) -> Result<Vec<Release>, CircleFtpError> {
        let url = format!("{}/posts/{}", self.base_url, id);
        let resp = self.client.get(&url).send().await?;
        let json: serde_json::Value = resp.json().await?;

        let mut releases = Vec::new();
        let r#type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

        let quality_str = json.get("quality").and_then(|v| v.as_str()).unwrap_or("HD");
        let quality = if quality_str.to_lowercase().contains("1080p") {
            Some("1080p".to_string())
        } else if quality_str.to_lowercase().contains("720p") {
            Some("720p".to_string())
        } else if quality_str.to_lowercase().contains("4k")
            || quality_str.to_lowercase().contains("2160p")
        {
            Some("4k".to_string())
        } else {
            Some(quality_str.to_string())
        };

        let title_str = json.get("title").and_then(|v| v.as_str()).unwrap_or("");

        let t_lower = title_str.to_lowercase();

        let codec = [
            ("x264", "x264"),
            ("h264", "x264"),
            ("x265", "HEVC"),
            ("hevc", "HEVC"),
            ("av1", "AV1"),
        ]
        .iter()
        .find(|(k, _)| t_lower.contains(k))
        .map(|(_, v)| v.to_string());

        let language = [
            ("hindi", "Hindi"),
            ("bengali", "Bengali"),
            ("bangla", "Bengali"),
            ("english", "English"),
            ("tamil", "Tamil"),
            ("telugu", "Telugu"),
            ("malayalam", "Malayalam"),
        ]
        .iter()
        .find(|(k, _)| t_lower.contains(k))
        .map(|(_, v)| v.to_string());

        if r#type == "series" {
            if let (Some(target_s), Some(target_e)) = (season, episode) {
                if let Some(content) = json.get("content").and_then(|v| v.as_array()) {
                    if let Some(s_val) = content.get(target_s.saturating_sub(1)) {
                        if let Some(ep_arr) = s_val.get("episodes").and_then(|v| v.as_array()) {
                            if let Some(e_val) = ep_arr.get(target_e.saturating_sub(1)) {
                                if let Some(link) = e_val.get("link").and_then(|v| v.as_str()) {
                                    let filename = link
                                        .split('/')
                                        .next_back()
                                        .unwrap_or("Video File")
                                        .replace("%20", " ")
                                        .replace("%28", "(")
                                        .replace("%29", ")")
                                        .replace("%5B", "[")
                                        .replace("%5D", "]");
                                    let size_bytes = self.fetch_size(link).await;

                                    releases.push(Release {
                                        provider: ProviderKind::BdixCircleFtp,
                                        filename,
                                        quality: quality.clone(),
                                        codec: codec.clone(),
                                        language: language.clone(),
                                        size_bytes,
                                        season: Some(target_s),
                                        episode: Some(target_e),
                                        mirrors: vec![SourceMirror {
                                            label: "CircleFTP".to_string(),
                                            resolver_url: link.to_string(),
                                            headers: Vec::new(),
                                            direct_file: true,
                                        }],
                                    });
                                }
                            }
                        }
                    }
                }
            }
        } else {
            if let Some(content) = json.get("content").and_then(|v| v.as_str()) {
                let filename = content
                    .split('/')
                    .next_back()
                    .unwrap_or("Video File")
                    .replace("%20", " ")
                    .replace("%28", "(")
                    .replace("%29", ")")
                    .replace("%5B", "[")
                    .replace("%5D", "]");
                let size_bytes = self.fetch_size(content).await;

                releases.push(Release {
                    provider: ProviderKind::BdixCircleFtp,
                    filename,
                    quality: quality.clone(),
                    codec: codec.clone(),
                    language: language.clone(),
                    size_bytes,
                    season: None,
                    episode: None,
                    mirrors: vec![SourceMirror {
                        label: "CircleFTP".to_string(),
                        resolver_url: content.to_string(),
                        headers: Vec::new(),
                        direct_file: true,
                    }],
                });
            }
        }

        Ok(releases)
    }

    pub async fn resolve_release(&self, resolver_url: &str) -> Result<String, CircleFtpError> {
        Ok(resolver_url.to_string())
    }
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}
