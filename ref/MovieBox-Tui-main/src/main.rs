use moviebox_tui::tui::app::App;

#[cfg(not(target_os = "android"))]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

struct TerminalGuard;

fn restore_terminal() {
    let _ = crossterm::execute!(
        std::io::stdout(),
        crossterm::cursor::Show,
        crossterm::event::DisableMouseCapture,
        crossterm::event::DisableFocusChange,
        crossterm::terminal::LeaveAlternateScreen
    );
    let _ = crossterm::terminal::disable_raw_mode();
}

fn purge_stale_subtitles() {
    tokio::task::spawn_blocking(|| {
        let max_age = 24 * 60 * 60;
        let mut dirs = vec![std::env::temp_dir().join("moviebox-tui/subs")];
        if let Some(home) = dirs::home_dir() {
            let android_storage = home.join("storage/downloads/moviebox_subs");
            if home.join("storage/downloads").exists() {
                dirs.push(android_storage);
            }
        }

        for dir in dirs {
            if dir.exists()
                && let Ok(entries) = std::fs::read_dir(&dir)
            {
                for entry in entries.flatten() {
                    if let Ok(metadata) = entry.metadata()
                        && let Ok(modified) = metadata.modified()
                        && let Ok(elapsed) = modified.elapsed()
                        && elapsed.as_secs() > max_age
                    {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    });
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        restore_terminal();
    }
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("moviebox-tui {}", env!("CARGO_PKG_VERSION"));
        println!("A terminal client for finding and streaming movies, TV shows, and anime.\n");
        println!("USAGE:");
        println!("    moviebox-tui [OPTIONS]\n");
        println!("OPTIONS:");
        println!("    -h, --help           Print help information");
        println!("    -v, -V, --version    Print version information\n");
        println!("ENVIRONMENT VARIABLES:");
        println!("    MOVIEBOX_LOG            Log level (info, warn, error, debug, trace)");
        println!("    MOVIEBOX_THEME          Theme name (e.g. catppuccin, dracula, nord, etc.)");
        println!("    MOVIEBOX_PLAYER         Preferred player (mpv, iina, vlc, android)");
        println!("    MOVIEBOX_MPV_PATH       Custom mpv binary path");
        println!("    MOVIEBOX_VLC_PATH       Custom vlc binary path");
        println!("    MOVIEBOX_IINA_PATH      Custom iina-cli binary path");
        println!("    MOVIEBOX_FOURKHDHUB_URL Custom 4KHDHub base URL");
        println!("    MOVIEBOX_NO_IMAGE       Disable poster image queries (1/true)");
        return Ok(());
    }
    if args
        .iter()
        .any(|arg| arg == "--version" || arg == "-v" || arg == "-V")
    {
        println!("moviebox-tui {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    moviebox_tui::logging::init();

    std::panic::set_hook(Box::new(|info| {
        log::error!("panic: {info}");
        restore_terminal();
        eprintln!("{info}");
    }));

    let stdout = std::io::stdout();
    let backend =
        ratatui::backend::CrosstermBackend::new(std::io::BufWriter::with_capacity(65536, stdout));
    let mut terminal = ratatui::Terminal::new(backend)?;
    crossterm::terminal::enable_raw_mode()?;
    let _guard = TerminalGuard;
    crossterm::execute!(
        std::io::stdout(),
        crossterm::terminal::EnterAlternateScreen,
        crossterm::event::EnableMouseCapture,
        crossterm::event::EnableFocusChange
    )?;

    moviebox_tui::cache::clean_old_cache_background();
    purge_stale_subtitles();

    let mut app = App::new();
    if let Err(err) = app.run(&mut terminal).await {
        log::error!("application error: {err}");
    }
    Ok(())
}
