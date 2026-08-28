pub mod tracker;

use std::{path::Path, process::Command};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerKind {
    Mpv,
    Iina,
    Vlc,
    AndroidIntent,
}

impl PlayerKind {
    pub fn label(&self) -> &'static str {
        match self {
            PlayerKind::Mpv => "mpv",
            PlayerKind::Iina => "IINA",
            PlayerKind::Vlc => "VLC",
            PlayerKind::AndroidIntent => "Android Player",
        }
    }

    pub fn config_key(&self) -> &'static str {
        match self {
            PlayerKind::Mpv => "mpv",
            PlayerKind::Iina => "iina",
            PlayerKind::Vlc => "vlc",
            PlayerKind::AndroidIntent => "android",
        }
    }

    pub fn parse(value: &str) -> Option<PlayerKind> {
        match value.to_ascii_lowercase().as_str() {
            "mpv" => Some(PlayerKind::Mpv),
            "iina" => Some(PlayerKind::Iina),
            "vlc" => Some(PlayerKind::Vlc),
            "android" | "androidintent" | "android-intent" => Some(PlayerKind::AndroidIntent),
            _ => None,
        }
    }
}

pub fn detect() -> Vec<PlayerKind> {
    let mut players = Vec::new();

    #[cfg(target_os = "macos")]
    if iina_available() {
        players.push(PlayerKind::Iina);
    }

    if mpv_executable().is_some() {
        players.push(PlayerKind::Mpv);
    }

    if vlc_executable().is_some() {
        players.push(PlayerKind::Vlc);
    }

    if android_opener().is_some() {
        players.push(PlayerKind::AndroidIntent);
    }

    players
}

pub fn supports_headers(kind: PlayerKind, headers: &[(String, String)]) -> bool {
    if kind == PlayerKind::AndroidIntent {
        return false;
    }
    #[cfg(target_os = "macos")]
    if kind == PlayerKind::Iina && !iina_cli_exists() {
        return false;
    }
    kind != PlayerKind::Vlc
        || headers.iter().all(|(name, _)| {
            name.eq_ignore_ascii_case("referer") || name.eq_ignore_ascii_case("user-agent")
        })
}

pub fn command(
    kind: PlayerKind,
    url: &str,
    subtitle: Option<&str>,
    headers: &[(String, String)],
    window: Option<(u32, u32)>,
    resume_seconds: Option<u64>,
    tracker: Option<(&str, &str, usize, usize)>,
) -> Command {
    match kind {
        PlayerKind::Mpv => mpv_command(
            url,
            subtitle,
            headers,
            false,
            window,
            resume_seconds,
            tracker,
        ),
        PlayerKind::Iina => iina_command(url, subtitle, headers, window, resume_seconds, tracker),
        PlayerKind::Vlc => vlc_command(url, subtitle, headers, window, resume_seconds),
        PlayerKind::AndroidIntent => android_intent_command(url),
    }
}

fn build_player_process_command(executable: &str) -> Command {
    if executable.starts_with("flatpak run ") {
        let parts = executable.split_whitespace().collect::<Vec<_>>();
        let mut cmd = Command::new(parts.first().unwrap_or(&"flatpak"));
        if parts.len() > 1 && parts[1] == "run" {
            cmd.arg("run");
            cmd.arg("--file-forwarding");
            cmd.args(&parts[2..]);
        } else {
            cmd.args(&parts[1..]);
        }
        cmd
    } else {
        Command::new(executable)
    }
}

enum AndroidOpener {
    TermuxOpen(String),
    TermuxOpenUrl(String),
    TermuxAm(String),
    SystemAm(String),
}

fn is_termux_env() -> bool {
    std::env::var("PREFIX").is_ok_and(|p| p.contains("com.termux"))
        || Path::new("/data/data/com.termux/files/usr").exists()
}

fn android_opener() -> Option<AndroidOpener> {
    if let Some(custom) = configured_executable("MOVIEBOX_ANDROID_PLAYER_PATH") {
        if custom.ends_with("termux-open-url") {
            return Some(AndroidOpener::TermuxOpenUrl(custom));
        } else if custom.ends_with("termux-am") || custom.ends_with("/am") {
            return Some(AndroidOpener::TermuxAm(custom));
        } else {
            return Some(AndroidOpener::TermuxOpen(custom));
        }
    }

    let is_termux = is_termux_env();

    if let Ok(prefix) = std::env::var("PREFIX") {
        let termux_open = format!("{prefix}/bin/termux-open");
        if Path::new(&termux_open).is_file() {
            return Some(AndroidOpener::TermuxOpen(termux_open));
        }
        let termux_open_url = format!("{prefix}/bin/termux-open-url");
        if Path::new(&termux_open_url).is_file() {
            return Some(AndroidOpener::TermuxOpenUrl(termux_open_url));
        }
        let termux_am = format!("{prefix}/bin/termux-am");
        if Path::new(&termux_am).is_file() {
            return Some(AndroidOpener::TermuxAm(termux_am));
        }
        let am_bin = format!("{prefix}/bin/am");
        if Path::new(&am_bin).is_file() {
            return Some(AndroidOpener::TermuxAm(am_bin));
        }
    }

    let termux_open_static = "/data/data/com.termux/files/usr/bin/termux-open";
    if Path::new(termux_open_static).is_file() {
        return Some(AndroidOpener::TermuxOpen(termux_open_static.to_string()));
    }
    let termux_open_url_static = "/data/data/com.termux/files/usr/bin/termux-open-url";
    if Path::new(termux_open_url_static).is_file() {
        return Some(AndroidOpener::TermuxOpenUrl(
            termux_open_url_static.to_string(),
        ));
    }
    let termux_am_static = "/data/data/com.termux/files/usr/bin/termux-am";
    if Path::new(termux_am_static).is_file() {
        return Some(AndroidOpener::TermuxAm(termux_am_static.to_string()));
    }
    let termux_am_bin_static = "/data/data/com.termux/files/usr/bin/am";
    if Path::new(termux_am_bin_static).is_file() {
        return Some(AndroidOpener::TermuxAm(termux_am_bin_static.to_string()));
    }

    if let Some(path) = find_in_path("termux-open") {
        return Some(AndroidOpener::TermuxOpen(path));
    }
    if let Some(path) = find_in_path("termux-open-url") {
        return Some(AndroidOpener::TermuxOpenUrl(path));
    }
    if let Some(path) = find_in_path("termux-am") {
        return Some(AndroidOpener::TermuxAm(path));
    }

    if !is_termux {
        if Path::new("/system/bin/am").is_file() {
            return Some(AndroidOpener::SystemAm("/system/bin/am".to_string()));
        }
        if let Some(path) = find_in_path("am") {
            return Some(AndroidOpener::SystemAm(path));
        }
    }

    None
}

fn android_intent_command(url: &str) -> Command {
    let mut command = match android_opener() {
        Some(AndroidOpener::TermuxOpen(path)) => {
            let mut cmd = Command::new(path);
            cmd.arg("--chooser")
                .arg("--content-type")
                .arg("video/*")
                .arg(url);
            cmd
        }
        Some(AndroidOpener::TermuxOpenUrl(path)) => {
            let mut cmd = Command::new(path);
            cmd.arg(url);
            cmd
        }
        Some(AndroidOpener::TermuxAm(path)) => {
            let mut cmd = Command::new(path);
            cmd.arg("start")
                .arg("-a")
                .arg("android.intent.action.VIEW")
                .arg("-d")
                .arg(url)
                .arg("-t")
                .arg("video/*");
            cmd
        }
        Some(AndroidOpener::SystemAm(path)) => {
            let mut cmd = Command::new(path);
            cmd.arg("start")
                .arg("--user")
                .arg("0")
                .arg("-a")
                .arg("android.intent.action.VIEW")
                .arg("-d")
                .arg(url)
                .arg("-t")
                .arg("video/*");
            cmd
        }
        None => {
            let mut cmd = Command::new("termux-open");
            cmd.arg("--chooser")
                .arg("--content-type")
                .arg("video/*")
                .arg(url);
            cmd
        }
    };

    command.env_remove("LD_LIBRARY_PATH");
    command.env_remove("LD_PRELOAD");

    command
}

fn mpv_command(
    url: &str,
    subtitle: Option<&str>,
    headers: &[(String, String)],
    iina: bool,
    window: Option<(u32, u32)>,
    resume_seconds: Option<u64>,
    tracker: Option<(&str, &str, usize, usize)>,
) -> Command {
    let fallback = if cfg!(target_os = "windows") {
        "mpv.exe"
    } else {
        "mpv"
    };
    let executable = mpv_executable().unwrap_or_else(|| fallback.into());
    let mut command = build_player_process_command(&executable);
    let prefix = if iina { "--mpv-" } else { "--" };

    if let Some((width, height)) = window {
        command.arg(format!("{prefix}autofit={width}x{height}"));
    }
    command.arg(format!("{prefix}geometry=50%:50%"));

    if !iina {
        command.arg("--idle=no").arg("--keep-open=no");
    }

    if let Some(start) = resume_seconds {
        if start > 0 {
            command.arg(format!("{prefix}start={start}"));
        }
    }

    if let Some((provider, subject_id, season, episode)) = tracker {
        if let Some(script_path) = tracker::ensure_tracker_script() {
            let script_str = script_path.to_string_lossy().replace('\\', "/");
            command.arg(format!("{prefix}script={script_str}"));
            if let Some(state_file) =
                tracker::state_file_path(provider, subject_id, season, episode)
            {
                let opts =
                    format_mpv_script_opts(provider, subject_id, season, episode, &state_file);
                command.arg(format!("{prefix}script-opts={opts}"));
            }
        }
    }

    if !headers.is_empty() {
        let fields = headers
            .iter()
            .map(|(name, value)| format!("{name}: {value}"))
            .collect::<Vec<_>>()
            .join(",");
        command.arg(format!("{prefix}http-header-fields={fields}"));
    }
    if let Some(subtitle) = subtitle {
        let opt = if iina {
            "--mpv-sub-files"
        } else {
            "--sub-file"
        };
        let sub_path = subtitle.replace('\\', "/");
        command.arg(format!("{opt}={sub_path}"));
    }

    command.arg(url);

    command
}

#[cfg(target_os = "macos")]
fn iina_command(
    url: &str,
    subtitle: Option<&str>,
    headers: &[(String, String)],
    window: Option<(u32, u32)>,
    resume_seconds: Option<u64>,
    tracker: Option<(&str, &str, usize, usize)>,
) -> Command {
    let configured = configured_executable("MOVIEBOX_IINA_PATH");
    let cli_global = std::path::Path::new("/Applications/IINA.app/Contents/MacOS/iina-cli");
    let cli_local = dirs::home_dir()
        .map(|h| h.join("Applications/IINA.app/Contents/MacOS/iina-cli"))
        .unwrap_or_default();

    let mut command = if let Some(executable) = configured {
        Command::new(executable)
    } else if cli_global.exists() {
        let mut c = Command::new(cli_global);
        c.arg("--keep-running").arg("--no-stdin");
        c
    } else if cli_local.exists() {
        let mut c = Command::new(cli_local);
        c.arg("--keep-running").arg("--no-stdin");
        c
    } else if iina_app_exists() {
        let mut c = Command::new("open");
        c.arg("-a").arg("IINA").arg(url);
        return c;
    } else {
        Command::new("iina")
    };

    let mpv = mpv_command(
        url,
        subtitle,
        headers,
        true,
        window,
        resume_seconds,
        tracker,
    );
    for arg in mpv.get_args() {
        command.arg(arg);
    }
    command
}

#[cfg(not(target_os = "macos"))]
fn iina_command(
    url: &str,
    subtitle: Option<&str>,
    headers: &[(String, String)],
    window: Option<(u32, u32)>,
    resume_seconds: Option<u64>,
    tracker: Option<(&str, &str, usize, usize)>,
) -> Command {
    mpv_command(
        url,
        subtitle,
        headers,
        false,
        window,
        resume_seconds,
        tracker,
    )
}

fn vlc_command(
    url: &str,
    subtitle: Option<&str>,
    headers: &[(String, String)],
    window: Option<(u32, u32)>,
    resume_seconds: Option<u64>,
) -> Command {
    let fallback = if cfg!(target_os = "windows") {
        "vlc.exe"
    } else {
        "vlc"
    };
    let executable = vlc_executable().unwrap_or_else(|| fallback.into());
    let mut command = build_player_process_command(&executable);

    if let Some((width, height)) = window {
        command
            .arg(format!("--width={width}"))
            .arg(format!("--height={height}"));
    }
    command.arg("--play-and-exit");

    if let Some(start) = resume_seconds {
        if start > 0 {
            command.arg(format!("--start-time={start}"));
        }
    }

    for (name, value) in headers {
        if name.eq_ignore_ascii_case("referer") {
            command.arg(format!("--http-referrer={value}"));
        } else if name.eq_ignore_ascii_case("user-agent") {
            command.arg(format!("--http-user-agent={value}"));
        }
    }
    if let Some(subtitle) = subtitle {
        let sub_path = subtitle.replace('\\', "/");
        command.arg(format!("--sub-file={sub_path}"));
    }

    command.arg(url);
    command
}

fn mpv_executable() -> Option<String> {
    static CACHED: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    CACHED
        .get_or_init(|| {
            if let Some(executable) = configured_executable("MOVIEBOX_MPV_PATH") {
                return Some(executable);
            }

            let mut candidates = Vec::new();

            #[cfg(target_os = "windows")]
            {
                candidates.push(r"C:\Program Files\mpv\mpv.exe".to_string());
                candidates.push(r"C:\Program Files (x86)\mpv\mpv.exe".to_string());
                if let Ok(local) = std::env::var("LOCALAPPDATA") {
                    candidates.push(format!(r"{local}\Programs\mpv\mpv.exe"));
                }
                if let Ok(appdata) = std::env::var("APPDATA") {
                    candidates.push(format!(r"{appdata}\mpv\mpv.exe"));
                }
                if let Some(home) = dirs::home_dir() {
                    candidates.push(
                        home.join(r"scoop\shims\mpv.exe")
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                candidates.push(r"C:\ProgramData\chocolatey\bin\mpv.exe".to_string());
            }

            #[cfg(target_os = "macos")]
            {
                candidates.push("/Applications/mpv.app/Contents/MacOS/mpv".to_string());
                if let Some(home) = dirs::home_dir() {
                    candidates.push(
                        home.join("Applications/mpv.app/Contents/MacOS/mpv")
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                candidates.push("/opt/homebrew/bin/mpv".to_string());
                candidates.push("/usr/local/bin/mpv".to_string());
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                if let Ok(prefix) = std::env::var("PREFIX") {
                    candidates.push(format!("{prefix}/bin/mpv"));
                }
                candidates.push("/data/data/com.termux/files/usr/bin/mpv".to_string());
                if let Some(home) = dirs::home_dir() {
                    candidates.push(
                        home.join(".local/share/flatpak/exports/bin/io.mpv.Mpv")
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                candidates.push("/var/lib/flatpak/exports/bin/io.mpv.Mpv".to_string());
                candidates.push("/snap/bin/mpv".to_string());
                candidates.push("/var/lib/snapd/snap/bin/mpv".to_string());
                candidates.push("/usr/bin/mpv".to_string());
                candidates.push("/usr/local/bin/mpv".to_string());
                candidates.push("/app/bin/mpv".to_string());
            }

            for path in candidates {
                if Path::new(&path).is_file() {
                    return Some(path);
                }
            }

            let bin_names = if cfg!(target_os = "windows") {
                &["mpv.exe", "mpv"][..]
            } else {
                &["mpv", "io.mpv.Mpv"][..]
            };

            for bin in bin_names {
                if let Some(path) = find_in_path(bin) {
                    return Some(path);
                }
            }

            flatpak_executable("io.mpv.Mpv")
        })
        .clone()
}

fn vlc_executable() -> Option<String> {
    static CACHED: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    CACHED
        .get_or_init(|| {
            if let Some(executable) = configured_executable("MOVIEBOX_VLC_PATH") {
                return Some(executable);
            }

            let mut candidates = Vec::new();

            #[cfg(target_os = "windows")]
            {
                candidates.push(r"C:\Program Files\VideoLAN\VLC\vlc.exe".to_string());
                candidates.push(r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe".to_string());
                if let Ok(local) = std::env::var("LOCALAPPDATA") {
                    candidates.push(format!(r"{local}\Microsoft\WindowsApps\vlc.exe"));
                    candidates.push(format!(r"{local}\Programs\VLC\vlc.exe"));
                }
                if let Ok(appdata) = std::env::var("APPDATA") {
                    candidates.push(format!(r"{appdata}\vlc\vlc.exe"));
                }
                if let Some(home) = dirs::home_dir() {
                    candidates.push(
                        home.join(r"scoop\shims\vlc.exe")
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                candidates.push(r"C:\ProgramData\chocolatey\bin\vlc.exe".to_string());
            }

            #[cfg(target_os = "macos")]
            {
                candidates.push("/Applications/VLC.app/Contents/MacOS/VLC".to_string());
                if let Some(home) = dirs::home_dir() {
                    candidates.push(
                        home.join("Applications/VLC.app/Contents/MacOS/VLC")
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                candidates.push("/opt/homebrew/bin/vlc".to_string());
                candidates.push("/usr/local/bin/vlc".to_string());
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                if let Ok(prefix) = std::env::var("PREFIX") {
                    candidates.push(format!("{prefix}/bin/vlc"));
                }
                candidates.push("/data/data/com.termux/files/usr/bin/vlc".to_string());
                if let Some(home) = dirs::home_dir() {
                    candidates.push(
                        home.join(".local/share/flatpak/exports/bin/org.videolan.VLC")
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                candidates.push("/var/lib/flatpak/exports/bin/org.videolan.VLC".to_string());
                candidates.push("/snap/bin/vlc".to_string());
                candidates.push("/var/lib/snapd/snap/bin/vlc".to_string());
                candidates.push("/usr/bin/vlc".to_string());
                candidates.push("/usr/local/bin/vlc".to_string());
                candidates.push("/app/bin/vlc".to_string());
            }

            for path in candidates {
                if Path::new(&path).is_file() {
                    return Some(path);
                }
            }

            let bin_names = if cfg!(target_os = "windows") {
                &["vlc.exe", "vlc"][..]
            } else {
                &["vlc", "org.videolan.VLC"][..]
            };

            for bin in bin_names {
                if let Some(path) = find_in_path(bin) {
                    return Some(path);
                }
            }

            flatpak_executable("org.videolan.VLC")
        })
        .clone()
}

#[cfg(target_os = "macos")]
fn iina_available() -> bool {
    configured_executable("MOVIEBOX_IINA_PATH").is_some()
        || iina_app_exists()
        || executable_on_path("iina")
        || executable_on_path("iina-cli")
}

#[cfg(target_os = "macos")]
fn iina_app_exists() -> bool {
    Path::new("/Applications/IINA.app").exists()
        || dirs::home_dir().is_some_and(|home| home.join("Applications/IINA.app").exists())
}

#[cfg(target_os = "macos")]
fn iina_cli_exists() -> bool {
    let cli_global = Path::new("/Applications/IINA.app/Contents/MacOS/iina-cli");
    let cli_local = dirs::home_dir()
        .map(|h| h.join("Applications/IINA.app/Contents/MacOS/iina-cli"))
        .unwrap_or_default();
    configured_executable("MOVIEBOX_IINA_PATH").is_some()
        || cli_global.exists()
        || cli_local.exists()
        || executable_on_path("iina")
        || executable_on_path("iina-cli")
}

fn flatpak_executable(app_id: &str) -> Option<String> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    if executable_on_path("flatpak") {
        let mut cmd = Command::new("flatpak");
        cmd.arg("info")
            .arg(app_id)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        if cmd.output().map(|o| o.status.success()).unwrap_or(false) {
            return Some(format!("flatpak run {}", app_id));
        }

        let mut user_cmd = Command::new("flatpak");
        user_cmd
            .arg("info")
            .arg("--user")
            .arg(app_id)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        if user_cmd
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(format!("flatpak run {}", app_id));
        }
    }
    None
}

fn configured_executable(variable: &str) -> Option<String> {
    let val = std::env::var(variable).ok()?;
    let trimmed = val.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("flatpak run ")
        || Path::new(trimmed).exists()
        || executable_on_path(trimmed)
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn find_in_path(name: &str) -> Option<String> {
    if std::path::Path::new(name).is_file() {
        return Some(name.to_string());
    }
    #[cfg(windows)]
    if std::path::Path::new(&format!("{name}.exe")).is_file() {
        return Some(format!("{name}.exe"));
    }

    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        #[cfg(windows)]
        {
            let candidates = [
                candidate.clone(),
                candidate.with_extension("exe"),
                candidate.with_extension("cmd"),
            ];
            for c in candidates {
                if c.is_file() {
                    return Some(c.to_string_lossy().into_owned());
                }
            }
        }
        #[cfg(not(windows))]
        {
            if candidate.is_file() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if candidate
                        .metadata()
                        .map(|m| m.permissions().mode() & 0o111 != 0)
                        .unwrap_or(false)
                    {
                        return Some(candidate.to_string_lossy().into_owned());
                    }
                }
                #[cfg(not(unix))]
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn executable_on_path(name: &str) -> bool {
    find_in_path(name).is_some()
}

pub fn format_mpv_script_opts(
    provider: &str,
    subject_id: &str,
    season: usize,
    episode: usize,
    state_file: &Path,
) -> String {
    let state_file_str = state_file.to_string_lossy().replace('\\', "/");
    format!(
        "moviebox-provider={provider},moviebox-subject_id={subject_id},moviebox-season={season},moviebox-episode={episode},moviebox-state_file={state_file_str}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_format_mpv_script_opts_windows_paths() {
        let win_path = PathBuf::from(
            r"C:\Users\User\AppData\Local\MovieBox-Tui\playback\moviebox_123_1_1.json",
        );
        let opts = format_mpv_script_opts("moviebox", "123", 1, 1, &win_path);
        assert!(!opts.contains(r"\"));
        assert!(opts.contains("moviebox-state_file=C:/Users/User/AppData/Local/MovieBox-Tui/playback/moviebox_123_1_1.json"));
    }

    #[test]
    fn test_format_mpv_script_opts_unix_paths() {
        let unix_path =
            PathBuf::from("/home/user/.local/share/moviebox-tui/playback/moviebox_123_1_1.json");
        let opts = format_mpv_script_opts("moviebox", "123", 1, 1, &unix_path);
        assert!(opts.contains("moviebox-state_file=/home/user/.local/share/moviebox-tui/playback/moviebox_123_1_1.json"));
    }

    #[test]
    fn vlc_command_preserves_supported_playback_options() {
        let command = vlc_command(
            "https://example.test/video.m3u8",
            Some("/tmp/subtitle.srt"),
            &[
                ("Referer".into(), "https://example.test/".into()),
                ("User-Agent".into(), "MovieBox-Test".into()),
                ("Cookie".into(), "ignored=by-vlc-filter".into()),
            ],
            Some((1280, 720)),
            Some(42),
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(args.contains(&"--width=1280".into()));
        assert!(args.contains(&"--height=720".into()));
        assert!(args.contains(&"--play-and-exit".into()));
        assert!(args.contains(&"--start-time=42".into()));
        assert!(args.contains(&"--http-referrer=https://example.test/".into()));
        assert!(args.contains(&"--http-user-agent=MovieBox-Test".into()));
        assert!(args.contains(&"--sub-file=/tmp/subtitle.srt".into()));
        assert!(!args.iter().any(|arg| arg.starts_with("--http-cookie")));
        assert_eq!(
            args.last().map(String::as_str),
            Some("https://example.test/video.m3u8")
        );
    }

    #[test]
    fn vlc_command_normalizes_windows_subtitle_paths() {
        let command = vlc_command(
            "https://example.test/video.mp4",
            Some(r"C:\Users\User\AppData\Local\MovieBox-Tui\subs\sub.srt"),
            &[],
            None,
            None,
        );
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(
            args.contains(
                &"--sub-file=C:/Users/User/AppData/Local/MovieBox-Tui/subs/sub.srt".into()
            )
        );
    }

    #[test]
    fn header_support_rejects_android_and_unsupported_vlc_headers() {
        let headers = vec![("Cookie".into(), "session=secret".into())];
        assert!(!supports_headers(PlayerKind::AndroidIntent, &headers));
        assert!(!supports_headers(PlayerKind::Vlc, &headers));
        assert!(supports_headers(
            PlayerKind::Vlc,
            &[("referer".into(), "https://example.test/".into())]
        ));
    }

    #[test]
    fn test_android_intent_command_structure() {
        let cmd = android_intent_command("https://example.test/video.mp4");
        let args = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(args.contains(&"https://example.test/video.mp4".to_string()));
    }
}
