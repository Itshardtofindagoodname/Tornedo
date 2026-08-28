pub mod adapter;
pub mod aggregator;
pub mod client;
pub mod models;

pub use adapter::{meta_detail_to_moviebox_json, meta_to_search_result, releases_to_moviebox_json};
pub use aggregator::aggregate_streams;
pub use client::AddonClient;
pub use models::{AddonManifest, InstalledAddon, MetaDetail, MetaItem, StreamItem};

use crate::providers::models::ProviderKind;
use crate::providers::{Provider, ProviderCapabilities};

impl Provider for AddonClient {
    fn id(&self) -> ProviderKind {
        ProviderKind::Addons
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

    async fn search(&self, _query: &str, _page: usize) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({ "list": [] }))
    }

    async fn details(&self, _id: &str) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({}))
    }
}
