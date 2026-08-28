use crate::providers::models::{CatalogItem, MediaType, ProviderKind, ProviderMediaId};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CircleFtpPost {
    pub id: u64,
    pub title: Option<String>,
    pub name: Option<String>,
    pub r#type: Option<String>,
    pub year: Option<serde_json::Value>,
    pub quality: Option<String>,
    pub image: Option<String>,
    pub image_sm: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CircleFtpSearchResponse {
    pub posts: Option<Vec<CircleFtpPost>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CircleFtpSeason {
    pub season_name: Option<String>,
    pub episodes: Option<Vec<CircleFtpEpisode>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CircleFtpEpisode {
    pub title: Option<String>,
    pub link: Option<String>,
}

pub fn circleftp_search_to_catalog(response: &CircleFtpSearchResponse) -> Vec<CatalogItem> {
    let mut items = Vec::new();
    if let Some(posts) = &response.posts {
        for post in posts {
            let title = post
                .title
                .as_ref()
                .or(post.name.as_ref())
                .cloned()
                .unwrap_or_else(|| "Unknown".to_string());
            let media_type = if post.r#type.as_deref() == Some("series") {
                MediaType::Series
            } else {
                MediaType::Movie
            };

            let year = post.year.as_ref().and_then(|y| {
                if y.is_number() {
                    Some(y.to_string())
                } else {
                    y.as_str().map(|s| s.to_string())
                }
            });

            let poster_url = post
                .image
                .as_ref()
                .or(post.image_sm.as_ref())
                .map(|img| format!("http://new.circleftp.net:5000/uploads/{}", img));

            items.push(CatalogItem {
                id: ProviderMediaId {
                    provider: ProviderKind::BdixCircleFtp,
                    value: post.id.to_string(),
                },
                title,
                media_type,
                year,
                poster_url,
                season_count: None,
            });
        }
    }
    items
}
