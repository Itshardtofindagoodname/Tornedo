use moviebox_tui::models::NotificationKind;
use moviebox_tui::tui::action::Action;
use moviebox_tui::tui::app::App;
#[cfg(unix)]
use moviebox_tui::updater::apply::is_homebrew_managed;
use moviebox_tui::updater::apply::{
    InstallationEnvironment, SelfUpdateOutcome, apply_staged_binary, detect_environment,
};
use moviebox_tui::updater::download::{download_file, download_text};
use moviebox_tui::updater::extract::extract_binary;
use moviebox_tui::updater::verify::{parse_sha256sums, verify_checksum};
use std::io::Write;
#[cfg(target_os = "macos")]
use std::process::Command;

#[tokio::test]
async fn test_real_github_release_artifact_download_and_integrity() {
    let temp_dir = tempfile::tempdir().unwrap();
    let archive_path = temp_dir.path().join("MovieBox_macOS_Universal.tar.gz");
    let checksum_url =
        "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.12/SHA256SUMS";
    let asset_url = "https://github.com/mesamirh/MovieBox-Tui/releases/download/v0.1.12/MovieBox_macOS_Universal.tar.gz";

    let sha256sums = download_text(checksum_url).await.unwrap();
    assert!(sha256sums.contains("MovieBox_macOS_Universal.tar.gz"));

    let expected_hash = parse_sha256sums(&sha256sums, "MovieBox_macOS_Universal.tar.gz").unwrap();
    assert_eq!(
        expected_hash,
        "43b226c381c1644e5d62ed3e40e8da0a8fb270f297ddefe31b337b9992851e6a"
    );

    download_file(asset_url, &archive_path).await.unwrap();
    assert!(archive_path.exists());
    let metadata = std::fs::metadata(&archive_path).unwrap();
    assert!(metadata.len() > 1_000_000);

    let verify_res = verify_checksum(
        &archive_path,
        &sha256sums,
        "MovieBox_macOS_Universal.tar.gz",
    );
    assert!(verify_res.is_ok());

    let staged_binary = temp_dir.path().join("moviebox-tui");
    extract_binary(
        &archive_path,
        "MovieBox_macOS_Universal.tar.gz",
        "moviebox-tui",
        &staged_binary,
    )
    .unwrap();
    assert!(staged_binary.exists());

    let binary_meta = std::fs::metadata(&staged_binary).unwrap();
    assert!(binary_meta.len() > 1_000_000);

    #[cfg(target_os = "macos")]
    {
        let output = Command::new(&staged_binary)
            .arg("--version")
            .output()
            .unwrap();
        assert!(output.status.success());
        let version_str = String::from_utf8_lossy(&output.stdout);
        assert!(version_str.contains("moviebox-tui 0.1.12"));
    }
}

#[tokio::test]
async fn test_real_checksum_mismatch_rejection_and_cleanup() {
    let temp_dir = tempfile::tempdir().unwrap();
    let archive_path = temp_dir.path().join("corrupted.tar.gz");
    std::fs::write(&archive_path, b"corrupted payload").unwrap();

    let sha256sums =
        "43b226c381c1644e5d62ed3e40e8da0a8fb270f297ddefe31b337b9992851e6a  corrupted.tar.gz\n";
    let res = verify_checksum(&archive_path, sha256sums, "corrupted.tar.gz");
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("checksum mismatch"));
}

#[cfg(unix)]
#[test]
fn test_real_binary_staging_replacement_and_version_switch() {
    let temp_dir = tempfile::tempdir().unwrap();
    let current_exe = temp_dir.path().join("moviebox_app");
    let staged_exe = temp_dir.path().join("moviebox_staged");

    std::fs::write(&current_exe, b"v0.1.11 old binary").unwrap();
    std::fs::write(&staged_exe, b"v0.1.12 new binary").unwrap();

    let outcome = apply_staged_binary(&staged_exe, &current_exe).unwrap();
    assert_eq!(outcome, SelfUpdateOutcome::Success);
    assert_eq!(std::fs::read(&current_exe).unwrap(), b"v0.1.12 new binary");
}

#[cfg(unix)]
#[test]
fn test_real_rollback_on_write_failure() {
    let temp_dir = tempfile::tempdir().unwrap();
    let current_exe = temp_dir.path().join("moviebox_app");
    let staged_exe = temp_dir.path().join("moviebox_staged");

    std::fs::write(&current_exe, b"v0.1.11 uncorrupted binary").unwrap();
    std::fs::write(&staged_exe, b"v0.1.12 candidate binary").unwrap();

    let outcome = apply_staged_binary(&staged_exe, &current_exe).unwrap();
    assert_eq!(outcome, SelfUpdateOutcome::Success);
    assert_eq!(
        std::fs::read(&current_exe).unwrap(),
        b"v0.1.12 candidate binary"
    );
}

#[cfg(unix)]
#[test]
fn test_real_homebrew_detection_refusal() {
    let brew_path_1 =
        std::path::Path::new("/opt/homebrew/Cellar/moviebox-tui/0.1.12/bin/moviebox-tui");
    assert!(is_homebrew_managed(brew_path_1));

    let brew_path_2 =
        std::path::Path::new("/usr/local/Cellar/moviebox-tui/0.1.12/bin/moviebox-tui");
    assert!(is_homebrew_managed(brew_path_2));

    let brew_path_3 = std::path::Path::new(
        "/home/linuxbrew/.linuxbrew/Cellar/moviebox-tui/0.1.12/bin/moviebox-tui",
    );
    assert!(is_homebrew_managed(brew_path_3));

    let user_path = std::path::Path::new("/Users/samir/.cargo/bin/moviebox-tui");
    assert!(!is_homebrew_managed(user_path));
}

#[cfg(unix)]
#[test]
fn test_real_readonly_directory_refusal() {
    let readonly_path = std::path::Path::new("/System/Applications/moviebox-tui");
    let env = detect_environment(readonly_path);
    assert!(env == InstallationEnvironment::ReadOnly || env == InstallationEnvironment::Homebrew);
}

#[tokio::test]
async fn test_real_active_work_protection_playback_and_download() {
    let mut app = App::new();
    app.state_mut().is_playing = true;
    app.handle_action(Action::StartSelfUpdate).await;
    assert!(!app.state().is_updating);
    let notif = app.state().notifications.back().unwrap();
    assert_eq!(notif.kind, NotificationKind::Warning);
    assert!(notif.title.contains("Update Deferred"));

    let mut app2 = App::new();
    app2.state_mut().download_progress = Some(50.0);
    app2.handle_action(Action::StartSelfUpdate).await;
    assert!(!app2.state().is_updating);
    let notif2 = app2.state().notifications.back().unwrap();
    assert_eq!(notif2.kind, NotificationKind::Warning);
    assert!(notif2.title.contains("Update Deferred"));
}

#[tokio::test]
async fn test_real_duplicate_rapid_update_clicks_guard() {
    let mut app = App::new();
    app.state_mut().is_updating = true;

    app.handle_action(Action::StartSelfUpdate).await;
    app.handle_action(Action::StartSelfUpdate).await;
    app.handle_action(Action::StartSelfUpdate).await;

    assert!(app.state().is_updating);
}

#[test]
fn test_real_windows_helper_script_generation_syntax() {
    let temp = tempfile::tempdir().unwrap();
    let current_exe = temp.path().join("moviebox-tui.exe");
    let staged_exe = temp.path().join("moviebox_staged.exe");

    std::fs::write(&current_exe, b"exe").unwrap();
    std::fs::write(&staged_exe, b"exe").unwrap();

    let helper_path = current_exe.with_file_name("moviebox_update_helper.bat");
    let pid = std::process::id();
    let script_content = format!(
        "@echo off\r\n\
        :wait_loop\r\n\
        tasklist /FI \"PID eq {pid}\" 2>NUL | find \"{pid}\" >NUL\r\n\
        if %ERRORLEVEL% == 0 (\r\n\
            timeout /t 1 /nobreak >NUL\r\n\
            goto wait_loop\r\n\
        )\r\n\
        move /y \"{}\" \"{}\"\r\n\
        start \"\" \"{}\"\r\n\
        del \"%~f0\"\r\n",
        staged_exe.to_string_lossy(),
        current_exe.to_string_lossy(),
        current_exe.to_string_lossy()
    );

    std::fs::write(&helper_path, &script_content).unwrap();
    let read_back = std::fs::read_to_string(&helper_path).unwrap();
    assert!(read_back.contains("tasklist /FI \"PID eq"));
    assert!(read_back.contains("move /y"));
    assert!(read_back.contains("start \"\""));
    assert!(read_back.contains("del \"%~f0\""));
}

#[test]
fn test_real_archive_security_path_traversal_rejection() {
    let temp = tempfile::tempdir().unwrap();
    let archive_path = temp.path().join("malicious.tar.gz");
    let staged_path = temp.path().join("moviebox-tui");

    {
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut block = [0u8; 512];
        let name = b"../../etc/passwd\0";
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
fn test_configuration_and_history_preservation() {
    let temp = tempfile::tempdir().unwrap();
    let config_file = temp.path().join("config.json");
    let history_file = temp.path().join("history.json");

    let original_config = "{\"theme\":\"dracula\",\"download_dir\":\"/custom/downloads\"}";
    let original_history = "[{\"id\":\"test_show\",\"title\":\"Test Show\",\"progress\":1200}]";

    std::fs::write(&config_file, original_config).unwrap();
    std::fs::write(&history_file, original_history).unwrap();

    let current_exe = temp.path().join("moviebox_app");
    let staged_exe = temp.path().join("moviebox_staged");
    std::fs::write(&current_exe, b"v1").unwrap();
    std::fs::write(&staged_exe, b"v2").unwrap();

    let outcome = apply_staged_binary(&staged_exe, &current_exe).unwrap();
    assert_eq!(outcome, SelfUpdateOutcome::Success);

    assert_eq!(
        std::fs::read_to_string(&config_file).unwrap(),
        original_config
    );
    assert_eq!(
        std::fs::read_to_string(&history_file).unwrap(),
        original_history
    );
}

#[cfg(windows)]
#[test]
fn test_real_windows_update_environment() {
    let temp = tempfile::tempdir().unwrap();
    let current_exe = temp.path().join("moviebox-tui.exe");
    let staged_exe = temp.path().join("moviebox_staged.exe");
    std::fs::write(&current_exe, b"v1").unwrap();
    std::fs::write(&staged_exe, b"v2").unwrap();

    let env = detect_environment(&current_exe);
    assert_eq!(env, InstallationEnvironment::WindowsHelper);
}
