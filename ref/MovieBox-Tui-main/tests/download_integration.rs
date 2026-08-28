mod common;

use common::TempTestDir;
use moviebox_tui::download::{DEFAULT_STREAM_NAME, safe_file_stem};
use std::fs;

#[test]
fn test_safe_file_stem_empty_fallback() {
    assert_eq!(safe_file_stem(""), DEFAULT_STREAM_NAME);
    assert_eq!(safe_file_stem("   "), DEFAULT_STREAM_NAME);
    assert_eq!(safe_file_stem("..."), DEFAULT_STREAM_NAME);
    assert_eq!(safe_file_stem("___"), DEFAULT_STREAM_NAME);
}

#[test]
fn test_download_directory_structure_creation() {
    let temp_dir = TempTestDir::new("download_structure");
    let movie_dir = temp_dir.path.join("Movies").join("Inception (2010)");
    let series_dir = temp_dir
        .path
        .join("Series")
        .join("Breaking Bad")
        .join("Season 01");

    fs::create_dir_all(&movie_dir).expect("failed to create movie dir");
    fs::create_dir_all(&series_dir).expect("failed to create series dir");

    assert!(movie_dir.exists());
    assert!(series_dir.exists());

    let segment_file = series_dir.join("Breaking Bad - S01E01.mp4.0.part");
    fs::write(&segment_file, b"partial chunk data").expect("failed to write segment");
    assert!(segment_file.exists());
}

#[test]
fn test_multi_segment_assembly_simulation() {
    let temp_dir = TempTestDir::new("segment_assembly");
    let dest_file = temp_dir.path.join("Movie.mp4");
    let assembling_file = temp_dir.path.join("Movie.mp4.assembling");

    let chunk0 = b"CHUNK_000_BYTES_";
    let chunk1 = b"CHUNK_001_BYTES_";
    let chunk2 = b"CHUNK_002_BYTES_";

    let part0 = temp_dir.path.join("Movie.mp4.0.part");
    let part1 = temp_dir.path.join("Movie.mp4.1.part");
    let part2 = temp_dir.path.join("Movie.mp4.2.part");

    fs::write(&part0, chunk0).unwrap();
    fs::write(&part1, chunk1).unwrap();
    fs::write(&part2, chunk2).unwrap();

    let mut assembled = Vec::new();
    assembled.extend_from_slice(&fs::read(&part0).unwrap());
    assembled.extend_from_slice(&fs::read(&part1).unwrap());
    assembled.extend_from_slice(&fs::read(&part2).unwrap());

    fs::write(&assembling_file, &assembled).unwrap();
    fs::rename(&assembling_file, &dest_file).unwrap();

    let _ = fs::remove_file(&part0);
    let _ = fs::remove_file(&part1);
    let _ = fs::remove_file(&part2);

    assert!(dest_file.exists());
    assert_eq!(
        fs::read(&dest_file).unwrap().len(),
        chunk0.len() + chunk1.len() + chunk2.len()
    );
    assert!(!part0.exists());
    assert!(!part1.exists());
    assert!(!part2.exists());
    assert!(!assembling_file.exists());
}
