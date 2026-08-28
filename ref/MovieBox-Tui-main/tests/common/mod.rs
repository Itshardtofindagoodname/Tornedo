use moviebox_tui::history::WatchHistoryItem;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static COUNTER: AtomicUsize = AtomicUsize::new(1);

pub struct TempTestDir {
    pub path: PathBuf,
}

impl TempTestDir {
    pub fn new(prefix: &str) -> Self {
        let count = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir_name = format!("mb_test_{prefix}_{}_{}", std::process::id(), count);
        let path = std::env::temp_dir().join(dir_name);
        std::fs::create_dir_all(&path).expect("failed to create temp test dir");
        Self { path }
    }
}

impl Drop for TempTestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[allow(dead_code)]
pub fn make_history_item(
    provider: &str,
    subject_id: &str,
    title: &str,
    stype: i64,
    release_year: &str,
    season: usize,
    episode: usize,
) -> WatchHistoryItem {
    WatchHistoryItem {
        provider: provider.to_string(),
        subject_id: subject_id.to_string(),
        title: title.to_string(),
        cover_url: None,
        stype,
        release_year: release_year.to_string(),
        season,
        episode,
        timestamp: 1700000000,
        duration_seconds: Some(3600),
        progress_seconds: 1800,
        completed: false,
    }
}
