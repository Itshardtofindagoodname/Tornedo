use flexi_logger::{Cleanup, Criterion, FileSpec, Logger, Naming, WriteMode};

pub fn init() {
    let default_level = if cfg!(debug_assertions) {
        "info"
    } else {
        "warn"
    };
    let spec = std::env::var("MOVIEBOX_LOG")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_level.to_string());

    let log_dir = crate::config::logs_dir();

    match Logger::try_with_str(&spec) {
        Ok(logger) => {
            if let Err(error) = logger
                .log_to_file(
                    FileSpec::default()
                        .directory(&log_dir)
                        .basename(crate::config::APP_NAME),
                )
                .rotate(
                    Criterion::Size(5 * 1024 * 1024),
                    Naming::Numbers,
                    Cleanup::KeepLogFiles(3),
                )
                .write_mode(WriteMode::Direct)
                .format(flexi_logger::opt_format)
                .start()
            {
                eprintln!("[{}] logging unavailable: {error}", crate::config::APP_NAME);
            }
        }
        Err(error) => {
            eprintln!(
                "[{}] invalid MOVIEBOX_LOG level: {error}",
                crate::config::APP_NAME
            );
        }
    }

    log::info!(
        "session started | {} {} | {} | log file: {}",
        crate::config::APP_NAME,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        display_path()
    );
}

pub fn log_file_path() -> std::path::PathBuf {
    crate::config::logs_dir().join(format!("{}_rCURRENT.log", crate::config::APP_NAME))
}

pub fn display_path() -> String {
    sanitize_path(log_file_path())
}

pub fn sanitize_path(path: impl AsRef<std::path::Path>) -> String {
    let raw = path.as_ref().to_string_lossy().into_owned();
    dirs::home_dir()
        .and_then(|home| home.to_str().map(|home| home.to_string()))
        .map(|home| raw.replacen(&home, "~", 1))
        .unwrap_or(raw)
}

pub fn sanitize_url(raw: &str) -> String {
    match url::Url::parse(raw) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("unknown");
            let scheme = parsed.scheme();
            if host.is_empty() {
                "[redacted]".to_string()
            } else {
                format!("{scheme}://{host}")
            }
        }
        Err(_) => {
            let lower = raw.to_ascii_lowercase();
            let host_start = lower.find("://").map(|index| index + 3);
            match host_start {
                Some(start) => {
                    let rest = &raw[start..];
                    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
                    let host = &rest[..host_end];
                    if host.is_empty() {
                        "[redacted]".to_string()
                    } else {
                        format!("https://{host}")
                    }
                }
                None => "[redacted]".to_string(),
            }
        }
    }
}
