use moviebox_tui::history::{HistoryManager, PendingPlaybackState, WatchHistoryItem};
use moviebox_tui::providers::models::ProviderKind;
use moviebox_tui::tui::action::Action;
use moviebox_tui::tui::app::App;
use moviebox_tui::tui::state::Screen;

#[allow(clippy::too_many_arguments)]
fn dummy_history_item(
    provider: &str,
    subject_id: &str,
    title: &str,
    stype: i64,
    release_year: &str,
    season: usize,
    episode: usize,
    duration: Option<u64>,
    progress: u64,
    completed: bool,
) -> WatchHistoryItem {
    WatchHistoryItem {
        provider: provider.to_string(),
        subject_id: subject_id.to_string(),
        title: title.to_string(),
        cover_url: Some(format!("https://img.example.com/{subject_id}.jpg")),
        stype,
        release_year: release_year.to_string(),
        season,
        episode,
        timestamp: 1000,
        duration_seconds: duration,
        progress_seconds: progress,
        completed,
    }
}

#[test]
fn test_streaming_mode_movie_partial_progress_and_resume() {
    let mut manager = HistoryManager::default();
    let movie = dummy_history_item(
        "moviebox",
        "mb_movie_100",
        "Interstellar",
        1,
        "2014",
        0,
        0,
        Some(10140),
        3600,
        false,
    );

    manager.update_progress(movie.clone(), 3600, Some(10140), false);

    assert_eq!(manager.recent.len(), 1);
    let item = manager.recent.first().unwrap();
    assert_eq!(item.provider, "moviebox");
    assert_eq!(item.subject_id, "mb_movie_100");
    assert_eq!(item.progress_seconds, 3600);
    assert_eq!(item.duration_seconds, Some(10140));
    assert!(item.is_in_progress());
    assert!(!item.completed);
    assert_eq!(item.progress_percentage(), Some(35.50296));

    let fetched = manager.get_item("moviebox", "mb_movie_100", 0, 0, Some("Interstellar"));
    assert!(fetched.is_some());
    let fetched_item = fetched.unwrap();
    assert_eq!(fetched_item.progress_seconds, 3600);
    assert!(fetched_item.is_in_progress());
}

#[test]
fn test_addon_mode_movie_partial_progress_and_resume() {
    let mut manager = HistoryManager::default();
    let addon_movie = dummy_history_item(
        "addons",
        "tt1160419",
        "Dune",
        1,
        "2021",
        0,
        0,
        Some(9300),
        4650,
        false,
    );

    manager.update_progress(addon_movie.clone(), 4650, Some(9300), false);

    assert_eq!(manager.recent.len(), 1);
    let item = manager.recent.first().unwrap();
    assert_eq!(item.provider, "addons");
    assert_eq!(item.subject_id, "tt1160419");
    assert_eq!(item.progress_seconds, 4650);
    assert_eq!(item.progress_percentage(), Some(50.0));
    assert!(item.is_in_progress());

    let fetched = manager.get_item("addons", "tt1160419", 0, 0, Some("Dune"));
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().progress_seconds, 4650);
}

#[test]
fn test_cross_mode_isolation_between_moviebox_and_addons() {
    let mut manager = HistoryManager::default();

    let mb_dune = dummy_history_item(
        "moviebox",
        "mb_dune_id",
        "Dune",
        1,
        "2021",
        0,
        0,
        Some(9300),
        2000,
        false,
    );
    let addon_dune = dummy_history_item(
        "addons",
        "tt1160419",
        "Dune",
        1,
        "2021",
        0,
        0,
        Some(9300),
        6000,
        false,
    );

    manager.update_progress(mb_dune.clone(), 2000, Some(9300), false);
    manager.update_progress(addon_dune.clone(), 6000, Some(9300), false);

    assert_eq!(manager.recent.len(), 2);
    assert!(!HistoryManager::is_same_show(&mb_dune, &addon_dune));

    let mb_res = manager
        .get_item("moviebox", "mb_dune_id", 0, 0, None)
        .unwrap();
    assert_eq!(mb_res.provider, "moviebox");
    assert_eq!(mb_res.progress_seconds, 2000);

    let addon_res = manager.get_item("addons", "tt1160419", 0, 0, None).unwrap();
    assert_eq!(addon_res.provider, "addons");
    assert_eq!(addon_res.progress_seconds, 6000);
}

#[test]
fn test_series_episode_advancement_and_completion_tracking() {
    let mut manager = HistoryManager::default();

    let ep1 = dummy_history_item(
        "moviebox",
        "mb_show_99",
        "Severance",
        2,
        "2022",
        1,
        1,
        Some(3600),
        3400,
        true,
    );
    manager.update_progress(ep1.clone(), 3400, Some(3600), true);

    assert!(manager.is_watched("moviebox", "mb_show_99", 1, 1));
    assert!(!manager.is_watched("moviebox", "mb_show_99", 1, 2));
    assert_eq!(manager.recent.len(), 1);
    assert_eq!(manager.recent.first().unwrap().episode, 1);
    assert!(manager.recent.first().unwrap().completed);

    let ep2 = dummy_history_item(
        "moviebox",
        "mb_show_99",
        "Severance",
        2,
        "2022",
        1,
        2,
        Some(3600),
        1200,
        false,
    );
    manager.update_progress(ep2.clone(), 1200, Some(3600), false);

    assert_eq!(manager.recent.len(), 1);
    let current = manager.recent.first().unwrap();
    assert_eq!(current.season, 1);
    assert_eq!(current.episode, 2);
    assert_eq!(current.progress_seconds, 1200);
    assert!(current.is_in_progress());
    assert!(!current.completed);

    assert!(manager.is_watched("moviebox", "mb_show_99", 1, 1));
    assert!(!manager.is_watched("moviebox", "mb_show_99", 1, 2));

    let ep1_reopen = dummy_history_item(
        "moviebox",
        "mb_show_99",
        "Severance",
        2,
        "2022",
        1,
        1,
        Some(3600),
        3600,
        true,
    );
    manager.mark_watched(ep1_reopen);

    assert!(manager.is_watched("moviebox", "mb_show_99", 1, 1));
}

#[test]
fn test_threshold_boundaries_for_is_in_progress() {
    let mut item = dummy_history_item(
        "moviebox",
        "m_test",
        "Test Film",
        1,
        "2023",
        0,
        0,
        Some(1000),
        0,
        false,
    );

    item.progress_seconds = 0;
    assert!(!item.is_in_progress());

    item.progress_seconds = 29;
    assert!(!item.is_in_progress());

    item.progress_seconds = 30;
    assert!(item.is_in_progress());

    item.progress_seconds = 500;
    assert!(item.is_in_progress());

    item.progress_seconds = 899;
    assert!(item.is_in_progress());

    item.progress_seconds = 900;
    assert!(!item.is_in_progress());

    item.progress_seconds = 999;
    assert!(!item.is_in_progress());

    item.completed = true;
    item.progress_seconds = 500;
    assert!(!item.is_in_progress());
}

#[test]
fn test_history_disk_persistence_roundtrip() {
    let temp_dir = tempfile::tempdir().unwrap();
    let history_file = temp_dir.path().join("history.json");

    let mut manager = HistoryManager::default();
    let item1 = dummy_history_item(
        "moviebox",
        "id1",
        "Movie 1",
        1,
        "2020",
        0,
        0,
        Some(5000),
        2500,
        false,
    );
    let item2 = dummy_history_item(
        "addons",
        "tt999999",
        "Series 1",
        2,
        "2021",
        1,
        3,
        Some(3000),
        3000,
        true,
    );

    manager.update_progress(item1, 2500, Some(5000), false);
    manager.update_progress(item2, 3000, Some(3000), true);

    let serialized = serde_json::to_string(&manager).unwrap();
    std::fs::write(&history_file, serialized.as_bytes()).unwrap();

    let read_content = std::fs::read_to_string(&history_file).unwrap();
    let loaded: HistoryManager = serde_json::from_str(&read_content).unwrap();

    assert_eq!(loaded.recent.len(), 2);
    assert!(loaded.is_watched("addons", "tt999999", 1, 3));
    assert!(!loaded.is_watched("moviebox", "id1", 0, 0));
}

#[test]
fn test_reconciliation_from_lua_tracker_state_files() {
    let temp_dir = tempfile::tempdir().unwrap();

    let state1 = PendingPlaybackState {
        provider: "moviebox".to_string(),
        subject_id: "show_alpha".to_string(),
        season: 1,
        episode: 1,
        progress_seconds: 3600,
        duration_seconds: Some(3600),
        completed: true,
        timestamp: 1100,
    };
    let state_file_1 = temp_dir.path().join("moviebox_show_alpha_1_1.json");
    std::fs::write(&state_file_1, serde_json::to_string(&state1).unwrap()).unwrap();

    let state2 = PendingPlaybackState {
        provider: "moviebox".to_string(),
        subject_id: "show_alpha".to_string(),
        season: 1,
        episode: 2,
        progress_seconds: 1500,
        duration_seconds: Some(3600),
        completed: false,
        timestamp: 1200,
    };
    let state_file_2 = temp_dir.path().join("moviebox_show_alpha_1_2.json");
    std::fs::write(&state_file_2, serde_json::to_string(&state2).unwrap()).unwrap();

    let mut manager = HistoryManager::default();
    manager.recent.push(dummy_history_item(
        "moviebox",
        "show_alpha",
        "Alpha Show",
        2,
        "2023",
        1,
        1,
        Some(3600),
        3600,
        true,
    ));

    let modified = manager.reconcile_from_dir(temp_dir.path());
    assert!(modified);

    assert!(manager.is_watched("moviebox", "show_alpha", 1, 1));
    assert!(!manager.is_watched("moviebox", "show_alpha", 1, 2));

    let current = manager.recent.first().unwrap();
    assert_eq!(current.season, 1);
    assert_eq!(current.episode, 2);
    assert_eq!(current.progress_seconds, 1500);

    assert!(!state_file_1.exists());
    assert!(!state_file_2.exists());
}

#[tokio::test]
async fn test_history_slash_command_populates_search_results_accurately() {
    let mut app = App::new();
    app.state_mut().history.clear();

    let item_mb = dummy_history_item(
        "moviebox",
        "mb_101",
        "Gladiator",
        1,
        "2000",
        0,
        0,
        Some(9000),
        4500,
        false,
    );
    let item_addon = dummy_history_item(
        "addons",
        "tt0111161",
        "The Shawshank Redemption",
        1,
        "1994",
        0,
        0,
        Some(8500),
        4250,
        false,
    );

    app.state_mut()
        .history
        .update_progress(item_mb, 4500, Some(9000), false);
    app.state_mut()
        .history
        .update_progress(item_addon, 4250, Some(8500), false);

    app.state_mut().active_screen = Screen::Home;
    app.handle_action(Action::Search {
        query: "/history".to_string(),
        force_refresh: false,
    })
    .await;

    assert_eq!(app.state().search_results.len(), 2);
    let titles: Vec<_> = app
        .state()
        .search_results
        .iter()
        .map(|r| r.title.as_str())
        .collect();
    assert!(titles.contains(&"Gladiator"));
    assert!(titles.contains(&"The Shawshank Redemption"));

    let providers: Vec<_> = app
        .state()
        .search_results
        .iter()
        .map(|r| r.provider)
        .collect();
    assert!(providers.contains(&ProviderKind::MovieBox));
    assert!(providers.contains(&ProviderKind::Addons));
}
