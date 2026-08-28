mod client;
mod hubcloud;
mod parser;

pub use client::{FourKHdHubClient, FourKHdHubError};
pub use parser::{details_to_moviebox_json, releases_to_moviebox_json, search_to_moviebox_json};

use crate::providers::models::{ProviderKind, Release};
use crate::providers::{Provider, ProviderCapabilities, ReleaseProvider};

impl Provider for FourKHdHubClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::FourKHdHub
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: false,
            supports_series: true,
            supports_subtitles: true,
            supports_homepage: false,
        }
    }

    async fn search(&self, query: &str, _page: usize) -> Result<serde_json::Value, String> {
        self.search(query)
            .await
            .map(|items| search_to_moviebox_json(&items))
            .map_err(|error| error.to_string())
    }

    async fn details(&self, id: &str) -> Result<serde_json::Value, String> {
        self.details(id)
            .await
            .map(|details| details_to_moviebox_json(&details))
            .map_err(|error| error.to_string())
    }
}

impl ReleaseProvider for FourKHdHubClient {
    async fn episode_streams(
        &self,
        id: &str,
        season: usize,
        episode: usize,
    ) -> Result<Vec<Release>, String> {
        self.releases(id, season, episode)
            .await
            .map_err(|error| error.to_string())
    }
}
