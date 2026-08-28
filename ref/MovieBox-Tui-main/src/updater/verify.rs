use sha2::{Digest, Sha256};
use std::path::Path;

pub fn compute_sha256(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("failed to open file for hashing: {e}"))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)
        .map_err(|e| format!("failed to read file for hashing: {e}"))?;
    let hash = hasher.finalize();
    Ok(format!("{hash:x}"))
}

pub fn parse_sha256sums(content: &str, expected_filename: &str) -> Result<String, String> {
    let target = expected_filename.trim();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let mut parts = line.split_whitespace();
        let hash = match parts.next() {
            Some(h) if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()) => h,
            _ => continue,
        };

        let filename_part = match parts.next() {
            Some(f) => f.trim_start_matches('*'),
            None => continue,
        };

        if filename_part == target || filename_part.ends_with(&format!("/{target}")) {
            return Ok(hash.to_ascii_lowercase());
        }
    }

    Err(format!(
        "checksum for {expected_filename} not found in SHA256SUMS"
    ))
}

pub fn verify_checksum(
    file_path: &Path,
    sha256sums_content: &str,
    expected_filename: &str,
) -> Result<(), String> {
    let expected_hash = parse_sha256sums(sha256sums_content, expected_filename)?;
    let actual_hash = compute_sha256(file_path)?;

    if actual_hash.to_ascii_lowercase() != expected_hash {
        return Err(format!(
            "checksum mismatch for {expected_filename}: expected {expected_hash}, got {actual_hash}"
        ));
    }

    Ok(())
}
