use super::{hubcloud, parser};
use crate::providers::models::{CatalogItem, MediaDetails, PlaybackSource, ProviderKind, Release};
use reqwest::Url;

const DEFAULT_BASE_URL: &str = "https://4khdhub.one/";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(thiserror::Error, Debug)]
pub enum FourKHdHubError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("invalid provider URL: {0}")]
    InvalidUrl(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("no playable mirrors: {0}")]
    NoPlayableMirror(String),
}

#[derive(Clone)]
pub struct FourKHdHubClient {
    client: reqwest::Client,
    base_url: Url,
}

impl FourKHdHubClient {
    pub fn new() -> Result<Self, FourKHdHubError> {
        let base = std::env::var("MOVIEBOX_FOURKHDHUB_URL")
            .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
        Self::with_base_url(&base)
    }

    pub fn with_base_url(base: &str) -> Result<Self, FourKHdHubError> {
        let base_url =
            Url::parse(base).map_err(|_| FourKHdHubError::InvalidUrl(base.to_string()))?;
        if base_url.scheme() != "https" {
            return Err(FourKHdHubError::InvalidUrl(base.to_string()));
        }
        Ok(Self {
            client: build_client(),
            base_url,
        })
    }

    pub async fn health_check(&self) -> Result<(), FourKHdHubError> {
        let response = self.client.get(self.base_url.clone()).send().await?;
        if !response.status().is_success() {
            return Err(FourKHdHubError::Parse(format!(
                "health check returned {}",
                response.status()
            )));
        }
        Ok(())
    }

    pub async fn search(&self, query: &str) -> Result<Vec<CatalogItem>, FourKHdHubError> {
        let mut url = self.base_url.clone();
        url.query_pairs_mut().append_pair("s", query);
        let html = self.fetch_text(url).await?;
        parser::parse_search(&self.base_url, &html)
    }

    pub async fn details(&self, id: &str) -> Result<MediaDetails, FourKHdHubError> {
        let url = self.provider_url(id)?;
        let html = self.fetch_text(url).await?;
        parser::parse_details(id, &html)
    }

    pub async fn releases(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, FourKHdHubError> {
        let url = self.provider_url(id)?;
        let html = self.fetch_text(url).await?;
        parser::parse_releases(&html, season, episode)
    }

    pub async fn resolve_release(
        &self,
        release: &Release,
    ) -> Result<PlaybackSource, FourKHdHubError> {
        if release.provider != ProviderKind::FourKHdHub {
            return Err(FourKHdHubError::Parse(
                "release belongs to another provider".into(),
            ));
        }
        let referer = self.base_url.as_str().trim_end_matches('/').to_string();
        let mut last_error = None;
        for mirror in &release.mirrors {
            let candidates = if mirror.resolver_url.contains("hubcloud.") {
                hubcloud::resolve(&self.client, &mirror.resolver_url).await
            } else if mirror.resolver_url.contains("hubdrive.") {
                hubcloud::resolve_hubdrive(&self.client, &mirror.resolver_url).await
            } else {
                hubcloud::validate_playback_url(&mirror.resolver_url)
                    .map(|url| vec![(url, mirror.label.clone(), mirror.headers.clone())])
            };
            if let Ok(candidates) = candidates {
                for (url, label, headers) in candidates {
                    let mut merged = headers;
                    if !merged
                        .iter()
                        .any(|(name, _)| name.eq_ignore_ascii_case("referer"))
                    {
                        merged.push(("Referer".to_string(), referer.clone()));
                    }
                    if !merged
                        .iter()
                        .any(|(name, _)| name.eq_ignore_ascii_case("user-agent"))
                    {
                        merged.push(("User-Agent".to_string(), BROWSER_UA.to_string()));
                    }
                    match self.preflight(&url, &merged).await {
                        Ok(playable_url) => {
                            log::info!(
                                "4KHDHub mirror playable: {label} ({})",
                                crate::logging::sanitize_url(&playable_url)
                            );
                            return Ok(PlaybackSource {
                                provider: ProviderKind::FourKHdHub,
                                url: playable_url,
                                headers: merged,
                                subtitle: None,
                                source_label: label,
                            });
                        }
                        Err(error) => {
                            log::warn!(
                                "4KHDHub mirror rejected ({label}): {error} [{}]",
                                crate::logging::sanitize_url(&url)
                            );
                            last_error = Some(error.to_string());
                        }
                    }
                }
            } else if let Err(error) = candidates {
                log::warn!("4KHDHub mirror candidates failed: {error}");
                last_error = Some(error.to_string());
            }
        }
        log::error!(
            "4KHDHub: no playable mirror for release {:?} (last: {:?})",
            release.filename,
            last_error
        );
        Err(FourKHdHubError::NoPlayableMirror(
            last_error.unwrap_or_else(|| "all mirrors rejected the stream probe".into()),
        ))
    }

    async fn preflight(
        &self,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<String, FourKHdHubError> {
        hubcloud::validate_playback_url(url)?;
        let mut request = self
            .client
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-");
        for (name, value) in headers {
            request = request.header(name, value);
        }
        let response = request.send().await?.error_for_status()?;
        let mut final_url = response.url().clone();
        hubcloud::validate_playback_url(final_url.as_str())?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if content_type.contains("text/html")
            || content_type.contains("application/zip")
            || content_type.contains("text/plain")
        {
            let wrapped = final_url
                .query_pairs()
                .find(|(name, _)| name == "link")
                .map(|(_, value)| value.into_owned())
                .filter(|value| value.starts_with("https://"))
                .ok_or_else(|| {
                    FourKHdHubError::Parse(format!("invalid media content type: {content_type}"))
                })?;
            hubcloud::validate_playback_url(&wrapped)?;
            let mut wrapped_request = self
                .client
                .get(&wrapped)
                .header(reqwest::header::RANGE, "bytes=0-");
            for (name, value) in headers {
                wrapped_request = wrapped_request.header(name, value);
            }
            let wrapped_response = wrapped_request.send().await?.error_for_status()?;
            final_url = wrapped_response.url().clone();
            hubcloud::validate_playback_url(final_url.as_str())?;
            let wrapped_type = wrapped_response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if wrapped_type.contains("text/html")
                || wrapped_type.contains("application/zip")
                || wrapped_type.contains("text/plain")
            {
                return Err(FourKHdHubError::Parse(format!(
                    "invalid wrapped media content type: {wrapped_type}"
                )));
            }
        }
        Ok(final_url.to_string())
    }

    async fn fetch_text(&self, url: Url) -> Result<String, FourKHdHubError> {
        let response = self.client.get(url).send().await?.error_for_status()?;
        Ok(response.text().await?)
    }

    fn provider_url(&self, id: &str) -> Result<Url, FourKHdHubError> {
        let url = self
            .base_url
            .join(id.trim_start_matches('/'))
            .map_err(|_| FourKHdHubError::InvalidUrl(id.to_string()))?;
        if url.host_str() != self.base_url.host_str() {
            return Err(FourKHdHubError::InvalidUrl(id.to_string()));
        }
        Ok(url)
    }
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(5))
        .user_agent(BROWSER_UA)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .unwrap_or_default()
}
