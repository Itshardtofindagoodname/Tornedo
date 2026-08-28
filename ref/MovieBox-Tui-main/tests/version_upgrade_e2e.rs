#![cfg(unix)]

use std::process::Command;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

use moviebox_tui::updater::apply::{SelfUpdateOutcome, apply_staged_binary};
use moviebox_tui::updater::download::{download_file, download_text};
use moviebox_tui::updater::extract::extract_binary;
use moviebox_tui::updater::verify::{compute_sha256, parse_sha256sums, verify_checksum};
use moviebox_tui::updater::{Release, ReleaseAsset, TargetPlatform, is_newer};

async fn spawn_mock_release_server(
    archive_bytes: Vec<u8>,
    checksum_bytes: Vec<u8>,
    shutdown_notify: Arc<Notify>,
) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_notify.notified() => {
                    break;
                }
                accept_res = listener.accept() => {
                    let (mut socket, _) = match accept_res {
                        Ok(conn) => conn,
                        Err(_) => break,
                    };

                    let mut buf = [0u8; 4096];
                    let n = match socket.read(&mut buf).await {
                        Ok(n) if n > 0 => n,
                        _ => continue,
                    };

                    let req = String::from_utf8_lossy(&buf[..n]);
                    let (status_line, body_bytes) = if req.contains("/SHA256SUMS") {
                        ("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n", checksum_bytes.clone())
                    } else if req.contains(".tar.gz") || req.contains(".zip") {
                        ("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n", archive_bytes.clone())
                    } else {
                        ("HTTP/1.1 404 Not Found\r\n", b"Not Found".to_vec())
                    };

                    let resp_header = format!(
                        "{}Content-Length: {}\r\nConnection: close\r\n\r\n",
                        status_line,
                        body_bytes.len()
                    );

                    let _ = socket.write_all(resp_header.as_bytes()).await;
                    let _ = socket.write_all(&body_bytes).await;
                    let _ = socket.flush().await;
                }
            }
        }
    });

    port
}

fn create_versioned_mock_executable(target_path: &std::path::Path, version: &str) {
    let script = format!(
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"moviebox-tui {}\"\n  exit 0\nfi\necho \"Running moviebox-tui {}\"\n",
        version, version
    );
    std::fs::write(target_path, script.as_bytes()).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(target_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(target_path, perms).unwrap();
    }
}

fn package_mock_archive(binary_path: &std::path::Path, archive_path: &std::path::Path) {
    let file = std::fs::File::create(archive_path).unwrap();
    let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut tar = tar::Builder::new(enc);

    let binary_data = std::fs::read(binary_path).unwrap();
    let mut header = tar::Header::new_gnu();
    header.set_path("moviebox-tui").unwrap();
    header.set_size(binary_data.len() as u64);
    header.set_mode(0o755);
    header.set_cksum();

    tar.append(&header, &binary_data[..]).unwrap();

    let readme = b"# MovieBox-Tui v0.1.13\nProduction test release\n";
    let mut readme_hdr = tar::Header::new_gnu();
    readme_hdr.set_path("README.md").unwrap();
    readme_hdr.set_size(readme.len() as u64);
    readme_hdr.set_mode(0o644);
    readme_hdr.set_cksum();
    tar.append(&readme_hdr, &readme[..]).unwrap();

    tar.finish().unwrap();
}

#[tokio::test]
async fn test_genuine_end_to_end_version_upgrade_0_1_12_to_0_1_13() {
    let temp_dir = tempfile::tempdir().unwrap();

    let installed_app_path = temp_dir.path().join("moviebox_installed_app");
    create_versioned_mock_executable(&installed_app_path, "0.1.12");

    let initial_output = Command::new(&installed_app_path)
        .arg("--version")
        .output()
        .unwrap();
    assert!(initial_output.status.success());
    let initial_version_str = String::from_utf8_lossy(&initial_output.stdout);
    assert_eq!(initial_version_str.trim(), "moviebox-tui 0.1.12");

    let v0_1_13_binary_source = temp_dir.path().join("moviebox_v0_1_13_source");
    create_versioned_mock_executable(&v0_1_13_binary_source, "0.1.13");

    let target_platform = TargetPlatform::current().unwrap();
    let asset_name = target_platform.expected_asset_name();

    let v0_1_13_archive = temp_dir.path().join(asset_name);
    package_mock_archive(&v0_1_13_binary_source, &v0_1_13_archive);

    let archive_bytes = std::fs::read(&v0_1_13_archive).unwrap();
    let archive_sha256 = compute_sha256(&v0_1_13_archive).unwrap();
    let checksum_content = format!("{}  {}\n", archive_sha256, asset_name);
    let checksum_bytes = checksum_content.as_bytes().to_vec();

    let shutdown_notify = Arc::new(Notify::new());
    let port =
        spawn_mock_release_server(archive_bytes, checksum_bytes, shutdown_notify.clone()).await;

    let release = Release {
        version: "0.1.13".to_string(),
        tag_name: "v0.1.13".to_string(),
        notes:
            "### Release v0.1.13\n• Self-update pipeline fully enabled\n• Real-world upgrade test"
                .to_string(),
        assets: vec![
            ReleaseAsset {
                name: asset_name.to_string(),
                download_url: format!("http://127.0.0.1:{}/{}", port, asset_name),
                size: Some(v0_1_13_archive.metadata().unwrap().len()),
            },
            ReleaseAsset {
                name: "SHA256SUMS".to_string(),
                download_url: format!("http://127.0.0.1:{}/SHA256SUMS", port),
                size: Some(checksum_content.len() as u64),
            },
        ],
    };

    assert!(is_newer("0.1.12", &release.version));
    assert_eq!(&release.version, "0.1.13");
    assert_ne!("0.1.12", &release.version);

    let asset = release.find_compatible_asset(target_platform).unwrap();
    let checksum_asset = release.find_checksum_asset().unwrap();

    let downloaded_archive = temp_dir.path().join("downloaded_upgrade.tar.gz");
    download_file(&asset.download_url, &downloaded_archive)
        .await
        .unwrap();
    assert!(downloaded_archive.exists());

    let downloaded_checksums = download_text(&checksum_asset.download_url).await.unwrap();
    assert_eq!(
        parse_sha256sums(&downloaded_checksums, asset_name).unwrap(),
        archive_sha256
    );

    verify_checksum(&downloaded_archive, &downloaded_checksums, asset_name).unwrap();

    let staged_binary = temp_dir.path().join("staged_upgrade_binary");
    extract_binary(
        &downloaded_archive,
        asset_name,
        target_platform.expected_binary_name(),
        &staged_binary,
    )
    .unwrap();
    assert!(staged_binary.exists());

    let apply_outcome = apply_staged_binary(&staged_binary, &installed_app_path).unwrap();
    assert_eq!(apply_outcome, SelfUpdateOutcome::Success);

    let upgraded_output = Command::new(&installed_app_path)
        .arg("--version")
        .output()
        .unwrap();
    assert!(upgraded_output.status.success());
    let upgraded_version_str = String::from_utf8_lossy(&upgraded_output.stdout);
    assert_eq!(upgraded_version_str.trim(), "moviebox-tui 0.1.13");

    assert_ne!(initial_version_str.trim(), upgraded_version_str.trim());
    assert_eq!(initial_version_str.trim(), "moviebox-tui 0.1.12");
    assert_eq!(upgraded_version_str.trim(), "moviebox-tui 0.1.13");

    shutdown_notify.notify_one();
}

#[tokio::test]
async fn test_corrupted_upgrade_artifact_leaves_current_version_intact() {
    let temp_dir = tempfile::tempdir().unwrap();

    let installed_app_path = temp_dir.path().join("moviebox_installed_app");
    create_versioned_mock_executable(&installed_app_path, "0.1.12");

    let initial_output = Command::new(&installed_app_path)
        .arg("--version")
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&initial_output.stdout).trim(),
        "moviebox-tui 0.1.12"
    );

    let target_platform = TargetPlatform::current().unwrap();
    let asset_name = target_platform.expected_asset_name();

    let corrupted_archive_bytes = b"CORRUPTED BYTES IN TRANSIT".to_vec();
    let valid_checksum = "43b226c381c1644e5d62ed3e40e8da0a8fb270f297ddefe31b337b9992851e6a";
    let checksum_content = format!("{}  {}\n", valid_checksum, asset_name);
    let checksum_bytes = checksum_content.as_bytes().to_vec();

    let shutdown_notify = Arc::new(Notify::new());
    let port = spawn_mock_release_server(
        corrupted_archive_bytes,
        checksum_bytes,
        shutdown_notify.clone(),
    )
    .await;

    let downloaded_archive = temp_dir.path().join("downloaded_corrupted.tar.gz");
    download_file(
        &format!("http://127.0.0.1:{}/{}", port, asset_name),
        &downloaded_archive,
    )
    .await
    .unwrap();

    let downloaded_checksums = download_text(&format!("http://127.0.0.1:{}/SHA256SUMS", port))
        .await
        .unwrap();

    let verify_res = verify_checksum(&downloaded_archive, &downloaded_checksums, asset_name);
    assert!(verify_res.is_err());
    let err_msg = verify_res.unwrap_err();
    assert!(err_msg.contains("checksum mismatch"));

    let still_intact_output = Command::new(&installed_app_path)
        .arg("--version")
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&still_intact_output.stdout).trim(),
        "moviebox-tui 0.1.12"
    );

    shutdown_notify.notify_one();
}
