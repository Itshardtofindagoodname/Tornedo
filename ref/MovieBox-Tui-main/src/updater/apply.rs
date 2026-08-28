use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelfUpdateOutcome {
    Success,
    RequiresManualUpgrade(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallationEnvironment {
    DirectReplace,
    Homebrew,
    ReadOnly,
    WindowsHelper,
}

pub fn detect_environment(exe_path: &Path) -> InstallationEnvironment {
    if is_homebrew_managed(exe_path) {
        return InstallationEnvironment::Homebrew;
    }

    if cfg!(windows) {
        return InstallationEnvironment::WindowsHelper;
    }

    if !is_writable(exe_path) {
        return InstallationEnvironment::ReadOnly;
    }

    InstallationEnvironment::DirectReplace
}

pub fn is_homebrew_managed(exe_path: &Path) -> bool {
    let check_path = |p: &Path| -> bool {
        let s = p.to_string_lossy();
        s.contains("/Cellar/")
            || s.contains("/opt/homebrew/")
            || s.contains("/usr/local/Cellar/")
            || s.contains("/home/linuxbrew/.linuxbrew/Cellar/")
    };

    if check_path(exe_path) {
        return true;
    }

    if let Ok(canonical) = exe_path.canonicalize() {
        if check_path(&canonical) {
            return true;
        }
    }

    false
}

pub fn is_writable(exe_path: &Path) -> bool {
    let parent = match exe_path.parent() {
        Some(p) => p,
        None => return false,
    };

    let test_file = parent.join(format!(".moviebox_write_test_{}", std::process::id()));
    match std::fs::File::create(&test_file) {
        Ok(_) => {
            let _ = std::fs::remove_file(test_file);
            true
        }
        Err(_) => false,
    }
}

pub fn apply_staged_binary(
    staged_path: &Path,
    current_exe: &Path,
) -> Result<SelfUpdateOutcome, String> {
    let env = detect_environment(current_exe);

    match env {
        InstallationEnvironment::Homebrew => {
            Ok(SelfUpdateOutcome::RequiresManualUpgrade(
                "This installation is managed by Homebrew. Run: brew upgrade moviebox-tui".to_string(),
            ))
        }
        InstallationEnvironment::ReadOnly => {
            Ok(SelfUpdateOutcome::RequiresManualUpgrade(
                "MovieBox-Tui binary is not user-writable. Please update via your system package manager.".to_string(),
            ))
        }
        InstallationEnvironment::DirectReplace => {
            replace_binary_with_backup(staged_path, current_exe)?;
            Ok(SelfUpdateOutcome::Success)
        }
        InstallationEnvironment::WindowsHelper => {
            spawn_windows_helper(staged_path, current_exe)?;
            Ok(SelfUpdateOutcome::Success)
        }
    }
}

fn replace_binary_with_backup(staged_path: &Path, current_exe: &Path) -> Result<(), String> {
    let backup_path = current_exe.with_extension("old");
    if backup_path.exists() {
        let _ = std::fs::remove_file(&backup_path);
    }

    if let Err(e) = std::fs::rename(current_exe, &backup_path) {
        if let Err(copy_err) = std::fs::copy(current_exe, &backup_path) {
            return Err(format!(
                "failed to backup existing binary: {e} (copy: {copy_err})"
            ));
        }
    }

    let install_result = match std::fs::rename(staged_path, current_exe) {
        Ok(_) => Ok(()),
        Err(_) => match std::fs::copy(staged_path, current_exe) {
            Ok(_) => {
                let _ = std::fs::remove_file(staged_path);
                Ok(())
            }
            Err(copy_err) => Err(format!("failed to replace binary: {copy_err}")),
        },
    };

    if let Err(err) = install_result {
        if backup_path.exists() {
            let _ = std::fs::rename(&backup_path, current_exe);
        }
        return Err(err);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(current_exe) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(current_exe, perms);
        }
    }

    if backup_path.exists() {
        let _ = std::fs::remove_file(&backup_path);
    }

    Ok(())
}

fn spawn_windows_helper(staged_path: &Path, current_exe: &Path) -> Result<(), String> {
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
        staged_path.to_string_lossy(),
        current_exe.to_string_lossy(),
        current_exe.to_string_lossy()
    );

    std::fs::write(&helper_path, script_content)
        .map_err(|e| format!("failed to write Windows update helper: {e}"))?;

    Command::new("cmd.exe")
        .args(["/C", &helper_path.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("failed to spawn Windows update helper: {e}"))?;

    Ok(())
}

pub fn restart_process(exe_path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let args: Vec<String> = std::env::args().skip(1).collect();
        let err = Command::new(exe_path).args(&args).exec();
        Err(format!("failed to exec restarted process: {err}"))
    }

    #[cfg(windows)]
    {
        Ok(())
    }
}
