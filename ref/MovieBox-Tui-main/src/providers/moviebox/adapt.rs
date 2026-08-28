use crate::providers::models::SubtitleOption;

pub fn captions_json_to_options(payload: &serde_json::Value) -> Vec<SubtitleOption> {
    let Some(captions) = payload.get("extCaptions").and_then(|c| c.as_array()) else {
        return Vec::new();
    };
    captions
        .iter()
        .filter_map(|cap| {
            let url = cap.get("url").and_then(|u| u.as_str())?;
            if url.is_empty() {
                return None;
            }
            let name = cap
                .get("lanName")
                .and_then(|n| n.as_str())
                .unwrap_or("Unknown")
                .to_string();
            Some(SubtitleOption {
                name,
                url: url.to_string(),
            })
        })
        .collect()
}
