pub mod apply;
pub mod artifact;
pub mod check;
pub mod download;
pub mod extract;
pub mod verify;

pub use apply::{
    InstallationEnvironment, SelfUpdateOutcome, apply_staged_binary, detect_environment,
    is_homebrew_managed, is_writable, restart_process,
};
pub use artifact::{Release, ReleaseAsset, TargetPlatform, is_termux_environment};
pub use check::{check, check_release, is_newer};

pub async fn perform_self_update(
    release: &Release,
    progress_sender: Option<&tokio::sync::mpsc::UnboundedSender<String>>,
) -> Result<SelfUpdateOutcome, String> {
    let platform = TargetPlatform::current().ok_or_else(|| {
        "current operating system or architecture is not supported for in-app self-update"
            .to_string()
    })?;

    let asset = release.find_compatible_asset(platform).ok_or_else(|| {
        format!(
            "no compatible release asset found for platform {:?}",
            platform
        )
    })?;

    let checksum_asset = release
        .find_checksum_asset()
        .ok_or_else(|| "no SHA256SUMS checksum file found in GitHub release".to_string())?;

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("failed to get current executable path: {e}"))?;

    let env = detect_environment(&current_exe);
    if env == InstallationEnvironment::Homebrew {
        return Ok(SelfUpdateOutcome::RequiresManualUpgrade(
            "This installation is managed by Homebrew. Run: brew upgrade moviebox-tui".to_string(),
        ));
    }
    if env == InstallationEnvironment::ReadOnly {
        return Ok(SelfUpdateOutcome::RequiresManualUpgrade(
            "MovieBox-Tui binary is not user-writable. Please update via your system package manager.".to_string(),
        ));
    }

    let temp_dir = tempfile::Builder::new()
        .prefix("moviebox_update_")
        .tempdir()
        .map_err(|e| format!("failed to create temporary update directory: {e}"))?;

    let archive_path = temp_dir.path().join(&asset.name);
    let staged_binary_path = temp_dir.path().join(platform.expected_binary_name());

    if let Some(tx) = progress_sender {
        let _ = tx.send(format!("Downloading {}...", asset.name));
    }
    download::download_file(&asset.download_url, &archive_path).await?;

    if let Some(tx) = progress_sender {
        let _ = tx.send("Downloading SHA256SUMS...".to_string());
    }
    let sha256sums_content = download::download_text(&checksum_asset.download_url).await?;

    if let Some(tx) = progress_sender {
        let _ = tx.send("Verifying SHA-256 integrity...".to_string());
    }
    verify::verify_checksum(&archive_path, &sha256sums_content, &asset.name)?;

    if let Some(tx) = progress_sender {
        let _ = tx.send("Extracting binary from release archive...".to_string());
    }
    extract::extract_binary(
        &archive_path,
        &asset.name,
        platform.expected_binary_name(),
        &staged_binary_path,
    )?;

    if let Some(tx) = progress_sender {
        let _ = tx.send("Applying update to executable...".to_string());
    }
    let outcome = apply_staged_binary(&staged_binary_path, &current_exe)?;

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer_comprehensive_matrix() {
        assert!(is_newer("0.1.9", "0.1.10"));
        assert!(is_newer("0.1.10", "0.1.11"));
        assert!(is_newer("0.1.12", "0.1.13"));
        assert!(is_newer("1.9.0", "1.10.0"));
        assert!(is_newer("0.9.9", "1.0.0"));

        assert!(!is_newer("0.1.12", "0.1.12"));
        assert!(!is_newer("1.0.0", "1.0.0"));

        assert!(!is_newer("0.1.13", "0.1.12"));
        assert!(!is_newer("1.10.0", "1.9.0"));
        assert!(!is_newer("2.0.0", "1.9.9"));

        assert!(is_newer("v0.1.9", "v0.1.10"));
        assert!(is_newer("0.1.9", "v0.1.10"));
        assert!(is_newer("v0.1.9", "0.1.10"));
        assert!(!is_newer("v0.1.12", "v0.1.12"));
        assert!(!is_newer("v0.1.13", "v0.1.12"));

        assert!(is_newer("1.0.0-beta", "1.0.0"));
        assert!(is_newer("1.0.0-rc.1", "1.0.0"));
        assert!(is_newer("1.0.0-beta.1", "1.0.0-beta.2"));
        assert!(!is_newer("1.0.0", "1.0.0-beta"));
    }

    #[test]
    fn test_is_newer_non_semver_fallback() {
        assert!(is_newer("0.1.12", "custom-build-1"));
        assert!(!is_newer("custom-build-1", "custom-build-1"));
    }

    #[test]
    fn test_release_json_deserialization() {
        let raw_json = "{\"tag_name\": \"v0.1.13\", \"body\": \"### New Features\\n- Added cool feature\\n- Fixed bugs\"}";
        let item: serde_json::Value = serde_json::from_str(raw_json).unwrap();
        let tag = item["tag_name"].as_str().unwrap();
        let notes = item["body"].as_str().unwrap_or("").to_string();
        let release = Release {
            version: tag.trim_start_matches('v').to_string(),
            tag_name: tag.to_string(),
            notes,
            assets: Vec::new(),
        };
        assert_eq!(release.version, "0.1.13");
        assert!(release.notes.contains("### New Features"));
    }

    #[test]
    fn test_release_json_missing_body_graceful() {
        let raw_json = "{\"tag_name\": \"v0.1.13\"}";
        let item: serde_json::Value = serde_json::from_str(raw_json).unwrap();
        let tag = item["tag_name"].as_str().unwrap();
        let notes = item["body"].as_str().unwrap_or("").to_string();
        assert_eq!(notes, "");
        assert_eq!(tag.trim_start_matches('v'), "0.1.13");
    }

    fn sample_release_with_all_assets() -> Release {
        Release {
            version: "0.1.13".to_string(),
            tag_name: "v0.1.13".to_string(),
            notes: "Bug fixes and improvements".to_string(),
            assets: vec![
                ReleaseAsset {
                    name: "MovieBox_macOS_Universal.tar.gz".to_string(),
                    download_url: "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.13/MovieBox_macOS_Universal.tar.gz".to_string(),
                    size: Some(15_000_000),
                },
                ReleaseAsset {
                    name: "MovieBox_Linux_x64.tar.gz".to_string(),
                    download_url: "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.13/MovieBox_Linux_x64.tar.gz".to_string(),
                    size: Some(12_000_000),
                },
                ReleaseAsset {
                    name: "MovieBox_Linux_arm64.tar.gz".to_string(),
                    download_url: "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.13/MovieBox_Linux_arm64.tar.gz".to_string(),
                    size: Some(11_500_000),
                },
                ReleaseAsset {
                    name: "MovieBox_Windows_x64.zip".to_string(),
                    download_url: "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.13/MovieBox_Windows_x64.zip".to_string(),
                    size: Some(13_000_000),
                },
                ReleaseAsset {
                    name: "MovieBox_Windows_arm64.zip".to_string(),
                    download_url: "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.13/MovieBox_Windows_arm64.zip".to_string(),
                    size: Some(12_500_000),
                },
                ReleaseAsset {
                    name: "SHA256SUMS".to_string(),
                    download_url: "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.13/SHA256SUMS".to_string(),
                    size: Some(512),
                },
            ],
        }
    }

    #[test]
    fn test_update_asset_selection_for_current_platform() {
        let release = sample_release_with_all_assets();

        let mac_platform = TargetPlatform::detect("macos", "aarch64", false).unwrap();
        let mac_asset = release.find_compatible_asset(mac_platform).unwrap();
        assert_eq!(mac_asset.name, "MovieBox_macOS_Universal.tar.gz");

        let linux_x64 = TargetPlatform::detect("linux", "x86_64", false).unwrap();
        let linux_x64_asset = release.find_compatible_asset(linux_x64).unwrap();
        assert_eq!(linux_x64_asset.name, "MovieBox_Linux_x64.tar.gz");

        let linux_arm64 = TargetPlatform::detect("linux", "aarch64", false).unwrap();
        let linux_arm64_asset = release.find_compatible_asset(linux_arm64).unwrap();
        assert_eq!(linux_arm64_asset.name, "MovieBox_Linux_arm64.tar.gz");

        let win_x64 = TargetPlatform::detect("windows", "x86_64", false).unwrap();
        let win_x64_asset = release.find_compatible_asset(win_x64).unwrap();
        assert_eq!(win_x64_asset.name, "MovieBox_Windows_x64.zip");

        let win_arm64 = TargetPlatform::detect("windows", "arm64", false).unwrap();
        let win_arm64_asset = release.find_compatible_asset(win_arm64).unwrap();
        assert_eq!(win_arm64_asset.name, "MovieBox_Windows_arm64.zip");

        let checksum = release.find_checksum_asset().unwrap();
        assert_eq!(checksum.name, "SHA256SUMS");
    }

    #[test]
    fn test_update_asset_missing_for_current_platform() {
        let partial_release = Release {
            version: "0.1.13".to_string(),
            tag_name: "v0.1.13".to_string(),
            notes: "Partial release".to_string(),
            assets: vec![ReleaseAsset {
                name: "MovieBox_Linux_x64.tar.gz".to_string(),
                download_url: "https://...".to_string(),
                size: Some(1000),
            }],
        };

        let mac = TargetPlatform::detect("macos", "arm64", false).unwrap();
        assert!(partial_release.find_compatible_asset(mac).is_none());

        let win = TargetPlatform::detect("windows", "x86_64", false).unwrap();
        assert!(partial_release.find_compatible_asset(win).is_none());
    }

    #[test]
    fn test_update_asset_rejects_wrong_architecture() {
        assert!(TargetPlatform::detect("linux", "mips", false).is_none());
        assert!(TargetPlatform::detect("linux", "riscv64", false).is_none());
        assert!(TargetPlatform::detect("windows", "ia64", false).is_none());
    }

    #[test]
    fn test_update_asset_rejects_wrong_platform() {
        assert!(TargetPlatform::detect("freebsd", "x86_64", false).is_none());
        assert!(TargetPlatform::detect("openbsd", "x86_64", false).is_none());
        assert!(TargetPlatform::detect("solaris", "x86_64", false).is_none());
    }

    #[test]
    fn test_update_asset_termux_arm64_selection() {
        let release = sample_release_with_all_assets();
        let termux_arm64 = TargetPlatform::detect("linux", "aarch64", true).unwrap();
        assert_eq!(termux_arm64, TargetPlatform::LinuxArm64);

        let asset = release.find_compatible_asset(termux_arm64).unwrap();
        assert_eq!(asset.name, "MovieBox_Linux_arm64.tar.gz");

        assert!(TargetPlatform::detect("linux", "x86_64", true).is_none());
    }

    #[test]
    fn test_update_asset_multiple_candidates_deterministic() {
        let release = sample_release_with_all_assets();
        let platform = TargetPlatform::LinuxX64;
        let a1 = release.find_compatible_asset(platform);
        let a2 = release.find_compatible_asset(platform);
        assert_eq!(a1, a2);
        assert_eq!(a1.unwrap().name, "MovieBox_Linux_x64.tar.gz");
    }
}
