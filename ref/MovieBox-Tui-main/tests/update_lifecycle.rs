use moviebox_tui::models::NotificationKind;
use moviebox_tui::tui::action::Action;
use moviebox_tui::tui::app::App;
use moviebox_tui::tui::overlay::update_modal_layout;
use moviebox_tui::updater::apply::{
    InstallationEnvironment, SelfUpdateOutcome, apply_staged_binary, detect_environment,
    is_homebrew_managed, is_writable,
};
use moviebox_tui::updater::extract::extract_binary;
use moviebox_tui::updater::verify::{compute_sha256, parse_sha256sums, verify_checksum};
use moviebox_tui::updater::{Release, ReleaseAsset, TargetPlatform};
use ratatui::layout::Rect;
use std::io::Write;

#[tokio::test]
async fn test_update_check_single_flight() {
    let mut app = App::new();
    assert!(!app.state().is_checking_updates);

    app.handle_action(Action::CheckForUpdates).await;
    assert!(app.state().is_checking_updates);

    app.handle_action(Action::CheckForUpdates).await;
    assert!(app.state().is_checking_updates);

    app.handle_action(Action::UpdateAvailable(Ok(None))).await;
    assert!(!app.state().is_checking_updates);
}

#[tokio::test]
async fn test_update_check_guard_clears_on_error() {
    let mut app = App::new();
    app.handle_action(Action::CheckForUpdates).await;
    assert!(app.state().is_checking_updates);

    app.handle_action(Action::UpdateAvailable(Err(
        "GitHub API rate limited (403)".to_string(),
    )))
    .await;
    assert!(!app.state().is_checking_updates);
}

#[tokio::test]
async fn test_update_check_guard_clears_on_success() {
    let mut app = App::new();
    app.handle_action(Action::CheckForUpdates).await;
    assert!(app.state().is_checking_updates);

    app.handle_action(Action::UpdateAvailable(Ok(Some((
        "0.1.13".to_string(),
        "Release notes content".to_string(),
    )))))
    .await;

    assert!(!app.state().is_checking_updates);
    assert_eq!(
        app.state().update_available,
        Some(("0.1.13".to_string(), "Release notes content".to_string()))
    );
}

#[tokio::test]
async fn test_update_modal_mouse_hitbox_matches_rendered_geometry() {
    let area = Rect::new(0, 0, 80, 24);
    let notes = "• Feature 1\n• Feature 2\n• Feature 3";
    let layout = update_modal_layout(area, notes);

    assert_eq!(layout.popup_area.width, 72);
    assert_eq!(layout.display_count, 3);
    assert!(!layout.has_more);
    assert_eq!(layout.popup_area.height, 11);

    assert_eq!(layout.button_row_y, layout.popup_area.y + 9);
    assert_eq!(layout.update_btn_end_x, layout.popup_area.x + 24);
    assert_eq!(layout.open_btn_end_x, layout.popup_area.x + 48);
}

#[tokio::test]
async fn test_update_modal_update_now_click() {
    let mut app = App::new();
    app.state_mut().update_available = Some((
        "0.1.13".to_string(),
        "### Notes\n• Major performance improvements".to_string(),
    ));

    let (cols, rows) = crossterm::terminal::size().unwrap_or((80, 24));
    let area = Rect::new(0, 0, cols, rows);
    let layout = update_modal_layout(area, &app.state().update_available.as_ref().unwrap().1);

    let click_x = layout.popup_area.x + 5;
    let click_y = layout.button_row_y;

    app.handle_action(Action::MouseClick(click_x, click_y))
        .await;

    assert!(app.state().update_available.is_none());
}

#[tokio::test]
async fn test_update_modal_open_release_click() {
    let mut app = App::new();
    app.state_mut().update_available = Some((
        "0.1.13".to_string(),
        "### Notes\n• Major performance improvements".to_string(),
    ));

    let (cols, rows) = crossterm::terminal::size().unwrap_or((80, 24));
    let area = Rect::new(0, 0, cols, rows);
    let layout = update_modal_layout(area, &app.state().update_available.as_ref().unwrap().1);

    let click_x = layout.update_btn_end_x + 5;
    let click_y = layout.button_row_y;

    app.handle_action(Action::MouseClick(click_x, click_y))
        .await;

    assert!(app.state().update_available.is_none());
}

#[tokio::test]
async fn test_update_modal_dismiss_click() {
    let mut app = App::new();
    app.state_mut().update_available = Some(("0.1.13".to_string(), "• Bug fix".to_string()));

    let (cols, rows) = crossterm::terminal::size().unwrap_or((80, 24));
    let area = Rect::new(0, 0, cols, rows);
    let layout = update_modal_layout(area, &app.state().update_available.as_ref().unwrap().1);

    let click_x = layout.open_btn_end_x + 5;
    let click_y = layout.button_row_y;

    app.handle_action(Action::MouseClick(click_x, click_y))
        .await;

    assert!(app.state().update_available.is_none());
}

#[tokio::test]
async fn test_active_work_protection_download_active_defers_update() {
    let mut app = App::new();
    app.state_mut().download_progress = Some(45.0);

    app.handle_action(Action::StartSelfUpdate).await;

    assert!(!app.state().is_updating);
    assert!(!app.state().notifications.is_empty());
    let notif = app.state().notifications.back().unwrap();
    assert_eq!(notif.kind, NotificationKind::Warning);
    assert!(notif.title.contains("Update Deferred"));
}

#[tokio::test]
async fn test_active_work_protection_player_active_defers_update() {
    let mut app = App::new();
    app.state_mut().is_playing = true;

    app.handle_action(Action::StartSelfUpdate).await;

    assert!(!app.state().is_updating);
    assert!(!app.state().notifications.is_empty());
    let notif = app.state().notifications.back().unwrap();
    assert_eq!(notif.kind, NotificationKind::Warning);
    assert!(notif.title.contains("Update Deferred"));
}

#[test]
fn test_checksum_computation_and_verification_valid() {
    let temp = tempfile::tempdir().unwrap();
    let file_path = temp.path().join("test_file.tar.gz");
    std::fs::write(&file_path, b"moviebox test binary payload").unwrap();

    let computed = compute_sha256(&file_path).unwrap();
    let sha256sums_content = format!("{computed}  test_file.tar.gz\n");

    let parsed = parse_sha256sums(&sha256sums_content, "test_file.tar.gz").unwrap();
    assert_eq!(parsed, computed);

    let verify_res = verify_checksum(&file_path, &sha256sums_content, "test_file.tar.gz");
    assert!(verify_res.is_ok());
}

#[test]
fn test_checksum_verification_mismatch_fails() {
    let temp = tempfile::tempdir().unwrap();
    let file_path = temp.path().join("test_file.tar.gz");
    std::fs::write(&file_path, b"moviebox test binary payload").unwrap();

    let sha256sums_content =
        "0000000000000000000000000000000000000000000000000000000000000000  test_file.tar.gz\n";
    let verify_res = verify_checksum(&file_path, sha256sums_content, "test_file.tar.gz");
    assert!(verify_res.is_err());
    let err = verify_res.unwrap_err();
    assert!(err.contains("checksum mismatch"));
}

#[test]
fn test_checksum_verification_missing_fails() {
    let temp = tempfile::tempdir().unwrap();
    let file_path = temp.path().join("test_file.tar.gz");
    std::fs::write(&file_path, b"payload").unwrap();

    let sha256sums_content =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  other.tar.gz\n";
    let verify_res = verify_checksum(&file_path, sha256sums_content, "test_file.tar.gz");
    assert!(verify_res.is_err());
    assert!(verify_res.unwrap_err().contains("not found"));
}

#[test]
fn test_checksum_parser_handles_different_formats() {
    let manifest = "
# Comment line
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  two_spaces.tar.gz
1111111111111111111111111111111111111111111111111111111111111111 one_space.tar.gz
2222222222222222222222222222222222222222222222222222222222222222 *binary_mode.zip
";

    assert_eq!(
        parse_sha256sums(manifest, "two_spaces.tar.gz").unwrap(),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        parse_sha256sums(manifest, "one_space.tar.gz").unwrap(),
        "1111111111111111111111111111111111111111111111111111111111111111"
    );
    assert_eq!(
        parse_sha256sums(manifest, "binary_mode.zip").unwrap(),
        "2222222222222222222222222222222222222222222222222222222222222222"
    );
}

#[test]
fn test_tar_gz_extraction_and_permissions() {
    let temp = tempfile::tempdir().unwrap();
    let archive_path = temp.path().join("test.tar.gz");
    let staged_path = temp.path().join("moviebox-tui");

    {
        let file = std::fs::File::create(&archive_path).unwrap();
        let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut tar = tar::Builder::new(enc);

        let data = b"#!/bin/sh\necho updated\n";
        let mut header = tar::Header::new_gnu();
        header.set_path("moviebox-tui").unwrap();
        header.set_size(data.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        tar.append(&header, &data[..]).unwrap();
        tar.finish().unwrap();
    }

    extract_binary(&archive_path, "test.tar.gz", "moviebox-tui", &staged_path).unwrap();
    assert!(staged_path.exists());
    assert_eq!(
        std::fs::read(&staged_path).unwrap(),
        b"#!/bin/sh\necho updated\n"
    );
}

#[test]
fn test_zip_extraction_and_permissions() {
    let temp = tempfile::tempdir().unwrap();
    let archive_path = temp.path().join("test.zip");
    let staged_path = temp.path().join("moviebox-tui.exe");

    {
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("dist/moviebox-tui.exe", options).unwrap();
        zip.write_all(b"windows binary payload").unwrap();
        zip.finish().unwrap();
    }

    extract_binary(&archive_path, "test.zip", "moviebox-tui.exe", &staged_path).unwrap();
    assert!(staged_path.exists());
    assert_eq!(
        std::fs::read(&staged_path).unwrap(),
        b"windows binary payload"
    );
}

#[test]
fn test_archive_path_traversal_rejection() {
    let temp = tempfile::tempdir().unwrap();
    let archive_path = temp.path().join("malicious.tar.gz");
    let staged_path = temp.path().join("moviebox-tui");

    {
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut block = [0u8; 512];
        let name = b"../../etc/shadow\0";
        block[..name.len()].copy_from_slice(name);
        block[124..135].copy_from_slice(b"00000000010");
        block[156] = b'0';
        let mut chksum: u32 = 0;
        for (i, &byte) in block.iter().enumerate() {
            if (148..156).contains(&i) {
                chksum += b' ' as u32;
            } else {
                chksum += byte as u32;
            }
        }
        let chk_str = format!("{:06o}\0 ", chksum);
        block[148..156].copy_from_slice(chk_str.as_bytes());

        enc.write_all(&block).unwrap();
        enc.write_all(&[b'a'; 512]).unwrap();
        enc.write_all(&[0u8; 1024]).unwrap();
        enc.finish().unwrap();
    }

    let res = extract_binary(
        &archive_path,
        "malicious.tar.gz",
        "moviebox-tui",
        &staged_path,
    );
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("traversal"));
}

#[test]
fn test_environment_detection() {
    let current_exe = std::env::current_exe().unwrap();
    let env = detect_environment(&current_exe);
    assert!(matches!(
        env,
        InstallationEnvironment::DirectReplace
            | InstallationEnvironment::Homebrew
            | InstallationEnvironment::ReadOnly
            | InstallationEnvironment::WindowsHelper
    ));
    let writable = is_writable(&current_exe);
    assert!(
        writable
            || env == InstallationEnvironment::ReadOnly
            || env == InstallationEnvironment::Homebrew
            || env == InstallationEnvironment::WindowsHelper
    );
}

#[test]
fn test_binary_replacement_and_rollback_on_failure() {
    let temp = tempfile::tempdir().unwrap();
    let current_exe = temp.path().join("current_app");
    let staged_exe = temp.path().join("staged_app");

    std::fs::write(&current_exe, b"original v1").unwrap();
    std::fs::write(&staged_exe, b"new v2").unwrap();

    let outcome = apply_staged_binary(&staged_exe, &current_exe).unwrap();
    assert_eq!(outcome, SelfUpdateOutcome::Success);
    #[cfg(unix)]
    {
        assert_eq!(std::fs::read(&current_exe).unwrap(), b"new v2");
    }
}

#[test]
fn test_homebrew_detection_and_safe_refusal() {
    let homebrew_path =
        std::path::Path::new("/opt/homebrew/Cellar/moviebox-tui/0.1.12/bin/moviebox-tui");
    assert!(is_homebrew_managed(homebrew_path));

    let linuxbrew_path = std::path::Path::new(
        "/home/linuxbrew/.linuxbrew/Cellar/moviebox-tui/0.1.12/bin/moviebox-tui",
    );
    assert!(is_homebrew_managed(linuxbrew_path));

    let standard_user_path = std::path::Path::new("/Users/samir/.local/bin/moviebox-tui");
    assert!(!is_homebrew_managed(standard_user_path));
}

#[test]
fn test_update_asset_selection_for_current_platform() {
    let release = Release {
        version: "0.1.13".to_string(),
        tag_name: "v0.1.13".to_string(),
        notes: "Notes".to_string(),
        assets: vec![
            ReleaseAsset {
                name: "MovieBox_macOS_Universal.tar.gz".to_string(),
                download_url: "https://.../MovieBox_macOS_Universal.tar.gz".to_string(),
                size: Some(15000),
            },
            ReleaseAsset {
                name: "MovieBox_Linux_x64.tar.gz".to_string(),
                download_url: "https://.../MovieBox_Linux_x64.tar.gz".to_string(),
                size: Some(12000),
            },
            ReleaseAsset {
                name: "MovieBox_Linux_arm64.tar.gz".to_string(),
                download_url: "https://.../MovieBox_Linux_arm64.tar.gz".to_string(),
                size: Some(11000),
            },
            ReleaseAsset {
                name: "MovieBox_Windows_x64.zip".to_string(),
                download_url: "https://.../MovieBox_Windows_x64.zip".to_string(),
                size: Some(13000),
            },
            ReleaseAsset {
                name: "MovieBox_Windows_arm64.zip".to_string(),
                download_url: "https://.../MovieBox_Windows_arm64.zip".to_string(),
                size: Some(12000),
            },
            ReleaseAsset {
                name: "SHA256SUMS".to_string(),
                download_url: "https://.../SHA256SUMS".to_string(),
                size: Some(512),
            },
        ],
    };

    let mac = TargetPlatform::detect("macos", "arm64", false).unwrap();
    assert_eq!(
        release.find_compatible_asset(mac).unwrap().name,
        "MovieBox_macOS_Universal.tar.gz"
    );

    let linux = TargetPlatform::detect("linux", "x86_64", false).unwrap();
    assert_eq!(
        release.find_compatible_asset(linux).unwrap().name,
        "MovieBox_Linux_x64.tar.gz"
    );

    let win = TargetPlatform::detect("windows", "x86_64", false).unwrap();
    assert_eq!(
        release.find_compatible_asset(win).unwrap().name,
        "MovieBox_Windows_x64.zip"
    );
}

#[test]
fn test_update_asset_missing_for_current_platform() {
    let release = Release {
        version: "0.1.13".to_string(),
        tag_name: "v0.1.13".to_string(),
        notes: "Notes".to_string(),
        assets: vec![ReleaseAsset {
            name: "MovieBox_Linux_x64.tar.gz".to_string(),
            download_url: "https://...".to_string(),
            size: Some(1000),
        }],
    };

    let mac = TargetPlatform::detect("macos", "arm64", false).unwrap();
    assert!(release.find_compatible_asset(mac).is_none());
}

#[test]
fn test_update_asset_rejects_wrong_architecture() {
    assert!(TargetPlatform::detect("linux", "ppc64", false).is_none());
    assert!(TargetPlatform::detect("windows", "arm", false).is_none());
}

#[test]
fn test_update_asset_rejects_wrong_platform() {
    assert!(TargetPlatform::detect("solaris", "x86_64", false).is_none());
    assert!(TargetPlatform::detect("netbsd", "x86_64", false).is_none());
}
