use super::adapter::stream_item_to_release;
use super::client::AddonClient;
use super::models::InstalledAddon;
use crate::providers::models::Release;

pub async fn aggregate_streams(
    client: &AddonClient,
    addons: &[InstalledAddon],
    subject_id: &str,
    season: usize,
    episode: usize,
    is_series: bool,
) -> (Vec<Release>, Vec<String>) {
    let stream_addons: Vec<&InstalledAddon> = addons
        .iter()
        .filter(|a| a.enabled && a.provides_stream)
        .collect();

    if stream_addons.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let media_type = if is_series { "series" } else { "movie" };
    let stream_id = if is_series && season > 0 && episode > 0 {
        format!("{subject_id}:{season}:{episode}")
    } else {
        subject_id.to_string()
    };

    let mut tasks = Vec::new();
    for addon in stream_addons {
        let base_url = AddonClient::base_addon_url(&addon.manifest_url);
        let addon_name = addon.name.clone();
        let client_clone = client.clone();
        let id_clone = stream_id.clone();
        let m_type = media_type.to_string();

        tasks.push(tokio::spawn(async move {
            let streams_res = client_clone
                .fetch_streams(&base_url, &m_type, &id_clone)
                .await;
            match streams_res {
                Ok(items) => {
                    let mut releases = Vec::new();
                    for item in &items {
                        if let Some(rel) =
                            stream_item_to_release(&addon_name, item, season, episode)
                        {
                            releases.push(rel);
                        }
                    }
                    if !items.is_empty() && releases.is_empty() {
                        (releases, Some(addon_name))
                    } else {
                        (releases, None)
                    }
                }
                Err(_) => (Vec::new(), None),
            }
        }));
    }

    let results = futures::future::join_all(tasks).await;
    let mut all_releases = Vec::new();
    let mut blocked_addons = Vec::new();

    for res in results.into_iter().flatten() {
        all_releases.extend(res.0);
        if let Some(blocked) = res.1 {
            blocked_addons.push(blocked);
        }
    }

    all_releases.sort_by(|a, b| {
        let q_a = quality_score(a.quality.as_deref());
        let q_b = quality_score(b.quality.as_deref());
        match q_b.cmp(&q_a) {
            std::cmp::Ordering::Equal => {
                let size_a = a.size_bytes.unwrap_or(0);
                let size_b = b.size_bytes.unwrap_or(0);
                match size_b.cmp(&size_a) {
                    std::cmp::Ordering::Equal => {
                        let label_a = a.mirrors.first().map(|m| m.label.as_str()).unwrap_or("");
                        let label_b = b.mirrors.first().map(|m| m.label.as_str()).unwrap_or("");
                        label_a.cmp(label_b)
                    }
                    other => other,
                }
            }
            other => other,
        }
    });

    (all_releases, blocked_addons)
}

fn quality_score(quality: Option<&str>) -> u32 {
    match quality {
        Some("2160p") => 40,
        Some("1080p") => 30,
        Some("720p") => 20,
        Some("480p") => 10,
        _ => 0,
    }
}
