pub mod addons;
pub mod bdix;
pub mod fourkhdhub;
pub mod models;
pub mod moviebox;
pub mod tv;

pub use tv as m3u;

use models::{ProviderKind, Release};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub supports_search: bool,
    pub supports_pagination: bool,
    pub supports_series: bool,
    pub supports_subtitles: bool,
    pub supports_homepage: bool,
}

impl Default for ProviderCapabilities {
    fn default() -> Self {
        Self {
            supports_search: true,
            supports_pagination: false,
            supports_series: true,
            supports_subtitles: true,
            supports_homepage: false,
        }
    }
}

#[derive(Debug, thiserror::Error, Clone)]
pub enum ProviderError {
    #[error("Network connection failed: {0}")]
    Network(String),

    #[error("Rate limited by provider")]
    RateLimited(Option<u64>),

    #[error("Item not found on provider")]
    NotFound,

    #[error("Failed to parse response: {0}")]
    Parsing(String),

    #[error("Provider is temporarily unavailable: {0}")]
    Unavailable(String),
}

impl ProviderError {
    pub fn user_message(&self, provider: ProviderKind) -> String {
        match self {
            Self::Network(msg) => format!("Network error on {provider}: {msg}"),
            Self::RateLimited(secs) => match secs {
                Some(s) => format!("Rate limited on {provider}. Retry in {s}s."),
                None => format!("Rate limited on {provider}."),
            },
            Self::NotFound => format!("Content not found on {provider}."),
            Self::Parsing(msg) => format!("Parser error on {provider}: {msg}"),
            Self::Unavailable(msg) => format!("{provider} unavailable: {msg}"),
        }
    }
}

#[allow(async_fn_in_trait)]
pub trait Provider: Send + Sync {
    fn id(&self) -> ProviderKind;
    fn capabilities(&self) -> ProviderCapabilities;
    async fn search(&self, query: &str, page: usize) -> Result<serde_json::Value, String>;
    async fn details(&self, id: &str) -> Result<serde_json::Value, String>;
}

#[allow(async_fn_in_trait)]
pub trait ReleaseProvider: Send + Sync {
    async fn episode_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, String>;
}
