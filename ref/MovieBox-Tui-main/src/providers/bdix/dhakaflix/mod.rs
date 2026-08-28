pub mod client;

use crate::providers::models::{ProviderKind, Release};
use crate::providers::{
    Provider, ProviderCapabilities, ReleaseProvider,
    fourkhdhub::{details_to_moviebox_json, search_to_moviebox_json},
};

impl Provider for client::DhakaFlixClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::BdixDhakaFlix
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_search: true,
            supports_pagination: false,
            supports_series: true,
            supports_subtitles: false,
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

impl ReleaseProvider for client::DhakaFlixClient {
    async fn episode_streams(
        &self,
        id: &str,
        _season: usize,
        _episode: usize,
    ) -> Result<Vec<Release>, String> {
        self.streams(id).await.map_err(|error| error.to_string())
    }
}
