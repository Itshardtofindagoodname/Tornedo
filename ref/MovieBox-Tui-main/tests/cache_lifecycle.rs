mod common;

use common::TempTestDir;
use moviebox_tui::cache::{atomic_write_file, atomic_write_file_async, md5_hex};
use std::fs;

#[test]
fn test_md5_hex_determinism() {
    assert_eq!(
        md5_hex("https://example.com/stream.m3u8"),
        "6d61b1f81ddc272d47bef071abd229bd"
    );
    assert_eq!(md5_hex(""), "d41d8cd98f00b204e9800998ecf8427e");
    assert_ne!(md5_hex("query1"), md5_hex("query2"));
}

#[test]
fn test_atomic_write_sync() {
    let temp_dir = TempTestDir::new("cache_atomic_sync");
    let target_file = temp_dir.path.join("data.json");
    let content = b"{\"status\":\"cached\",\"results\":[1,2,3]}";

    atomic_write_file(&target_file, content).expect("atomic write failed");
    assert!(target_file.exists());

    let read_back = fs::read(&target_file).expect("failed to read back file");
    assert_eq!(read_back, content);
}

#[tokio::test]
async fn test_atomic_write_async() {
    let temp_dir = TempTestDir::new("cache_atomic_async");
    let target_file = temp_dir.path.join("async_data.json");
    let content = b"{\"async\":true,\"items\":[\"a\",\"b\"]}";

    atomic_write_file_async(&target_file, content)
        .await
        .expect("async atomic write failed");
    assert!(target_file.exists());

    let read_back = tokio::fs::read(&target_file)
        .await
        .expect("failed to read back async file");
    assert_eq!(read_back, content);
}

#[test]
fn test_atomic_overwrite_corrupt_data() {
    let temp_dir = TempTestDir::new("cache_corrupt_overwrite");
    let target_file = temp_dir.path.join("cache.json");

    fs::write(&target_file, b"CORRUPTED_PARTIAL_JSON_{{[").unwrap();
    assert!(target_file.exists());

    let valid_data = b"{\"valid\":true,\"recovered\":1}";
    atomic_write_file(&target_file, valid_data).unwrap();

    let content = fs::read(&target_file).unwrap();
    assert_eq!(content, valid_data);
    let parsed: serde_json::Value = serde_json::from_slice(&content).unwrap();
    assert_eq!(parsed["valid"], true);
}
