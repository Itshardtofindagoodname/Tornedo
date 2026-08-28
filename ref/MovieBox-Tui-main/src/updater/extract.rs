use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use flate2::read::GzDecoder;
use tar::Archive;

pub fn extract_binary(
    archive_path: &Path,
    asset_name: &str,
    expected_binary_name: &str,
    output_staged_path: &Path,
) -> Result<(), String> {
    if asset_name.ends_with(".tar.gz") || asset_name.ends_with(".tgz") {
        extract_tar_gz(archive_path, expected_binary_name, output_staged_path)
    } else if asset_name.ends_with(".zip") {
        extract_zip(archive_path, expected_binary_name, output_staged_path)
    } else {
        Err(format!("unsupported archive format: {asset_name}"))
    }
}

fn validate_relative_path(path: &Path) -> Result<(), String> {
    if path.is_absolute() {
        return Err("archive entry has absolute path".to_string());
    }

    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err("archive entry contains '..' traversal".to_string());
            }
            std::path::Component::Prefix(_) => {
                return Err("archive entry contains volume prefix".to_string());
            }
            std::path::Component::RootDir => {
                return Err("archive entry contains root directory".to_string());
            }
            _ => {}
        }
    }

    Ok(())
}

fn extract_tar_gz(
    archive_path: &Path,
    expected_binary_name: &str,
    output_staged_path: &Path,
) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| format!("failed to open archive: {e}"))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);

    let mut found = false;

    for entry_result in archive
        .entries()
        .map_err(|e| format!("corrupt tar archive: {e}"))?
    {
        let mut entry = entry_result.map_err(|e| format!("tar entry read error: {e}"))?;
        let entry_path = entry
            .path()
            .map_err(|e| format!("tar entry path error: {e}"))?
            .to_path_buf();

        validate_relative_path(&entry_path)?;

        let filename = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if filename == expected_binary_name {
            let mut out = File::create(output_staged_path)
                .map_err(|e| format!("failed to create staged binary: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("failed to write staged binary: {e}"))?;
            out.flush()
                .map_err(|e| format!("failed to flush staged binary: {e}"))?;
            found = true;
            break;
        }
    }

    if !found {
        return Err(format!(
            "binary '{expected_binary_name}' not found inside archive"
        ));
    }

    validate_and_set_permissions(output_staged_path)?;
    Ok(())
}

fn extract_zip(
    archive_path: &Path,
    expected_binary_name: &str,
    output_staged_path: &Path,
) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| format!("failed to open zip archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("corrupt zip archive: {e}"))?;

    let mut found = false;

    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| format!("zip entry read error: {e}"))?;
        if file.is_dir() {
            continue;
        }

        let enclosed_name = file
            .enclosed_name()
            .ok_or("zip entry path traversal detected")?;
        validate_relative_path(&enclosed_name)?;

        let filename = enclosed_name
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if filename == expected_binary_name {
            let mut out = File::create(output_staged_path)
                .map_err(|e| format!("failed to create staged binary: {e}"))?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)
                .map_err(|e| format!("failed to read zip entry data: {e}"))?;
            out.write_all(&buffer)
                .map_err(|e| format!("failed to write staged binary: {e}"))?;
            out.flush()
                .map_err(|e| format!("failed to flush staged binary: {e}"))?;
            found = true;
            break;
        }
    }

    if !found {
        return Err(format!(
            "binary '{expected_binary_name}' not found inside zip"
        ));
    }

    validate_and_set_permissions(output_staged_path)?;
    Ok(())
}

fn validate_and_set_permissions(path: &Path) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("staged binary metadata error: {e}"))?;
    if metadata.len() == 0 {
        return Err("extracted binary is empty".to_string());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = metadata.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms)
            .map_err(|e| format!("failed to set executable permissions: {e}"))?;
    }

    Ok(())
}
