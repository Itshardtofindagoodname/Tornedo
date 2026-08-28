use super::artifact::{Release, ReleaseAsset};

const OWNER: &str = "mesamirh";
const REPOSITORY: &str = "MovieBox-Tui";

pub async fn check_release(current: &str) -> Result<Option<Release>, String> {
    let release = match fetch_release().await {
        Ok(release) => release,
        Err(error) => {
            log::warn!("update check via API failed ({error}); falling back to release page");
            let tag = fetch_latest_tag().await?;
            log::info!("resolved latest release via redirect: {tag}");
            Release {
                version: tag.trim_start_matches('v').to_string(),
                tag_name: tag,
                notes: String::new(),
                assets: Vec::new(),
            }
        }
    };

    if !is_newer(current, &release.version) {
        return Ok(None);
    }

    Ok(Some(release))
}

pub async fn check(current: &str) -> Result<Option<(String, String)>, String> {
    let release = check_release(current).await?;
    Ok(release.map(|r| (r.version, r.notes)))
}

pub fn is_newer(current: &str, other: &str) -> bool {
    let parse = |v: &str| semver::Version::parse(v.trim_start_matches('v'));
    match (parse(current), parse(other)) {
        (Ok(cur), Ok(o)) => o > cur,
        _ => other != current,
    }
}

async fn fetch_release() -> Result<Release, String> {
    let url = format!("https://api.github.com/repos/{OWNER}/{REPOSITORY}/releases/latest");
    let client = http_client()?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {e}"))?;
    let status = resp.status();
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err(format!("GitHub API rate limited ({status})"));
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API {status}: {body}"));
    }

    let item: serde_json::Value = resp.json().await.map_err(|e| format!("bad JSON: {e}"))?;
    let tag = item["tag_name"].as_str().ok_or("missing tag_name")?;
    let notes = item["body"].as_str().unwrap_or("").to_string();
    let assets = if let Some(arr) = item["assets"].as_array() {
        arr.iter()
            .filter_map(|a| {
                let name = a["name"].as_str()?.to_string();
                let download_url = a["browser_download_url"].as_str()?.to_string();
                let size = a["size"].as_u64();
                Some(ReleaseAsset {
                    name,
                    download_url,
                    size,
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(Release {
        version: tag.trim_start_matches('v').to_string(),
        tag_name: tag.to_string(),
        notes,
        assets,
    })
}

async fn fetch_latest_tag() -> Result<String, String> {
    let url = format!("https://github.com/{OWNER}/{REPOSITORY}/releases/latest");
    let client = http_client()?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GitHub release page failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("GitHub release page {status}"));
    }

    let path = resp.url().path();
    let tag = path.rsplit('/').next().unwrap_or("");
    if tag.is_empty() || tag == "latest" {
        return Err("could not resolve the latest release tag".into());
    }
    Ok(tag.to_string())
}

pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("MovieBox-Tui")
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))
}
