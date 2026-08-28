mod common;

use common::{TempTestDir, make_history_item};
use moviebox_tui::history::{HistoryManager, PendingPlaybackState};
use std::fs;

#[test]
fn test_history_identity_rules() {
    let movie1 = make_history_item("moviebox", "mb_10", "Dune", 1, "2021", 0, 0);
    let movie2 = make_history_item("moviebox", "mb_10", "Dune: Part One", 1, "2021", 0, 0);
    assert!(HistoryManager::is_same_show(&movie1, &movie2));

    let series = make_history_item("moviebox", "mb_20", "Dune: Prophecy", 2, "2024", 1, 1);
    assert!(!HistoryManager::is_same_show(&movie1, &series));

    let addon_movie = make_history_item("addons", "tt1160419", "Dune", 1, "2021", 0, 0);
    assert!(!HistoryManager::is_same_show(&movie1, &addon_movie));

    let remake1978 = make_history_item("moviebox", "mb_h1", "Halloween", 1, "1978", 0, 0);
    let remake2018 = make_history_item("moviebox", "mb_h2", "Halloween", 1, "2018", 0, 0);
    assert!(!HistoryManager::is_same_show(&remake1978, &remake2018));
}

#[test]
fn test_history_reconciliation_multi_episode_flow() {
    let temp_dir = TempTestDir::new("hist_reconcile");
    let state_file_ep1 = temp_dir.path.join("moviebox_show1_1_1.json");
    let state_file_ep2 = temp_dir.path.join("moviebox_show1_1_2.json");

    let ep1_state = PendingPlaybackState {
        provider: "moviebox".to_string(),
        subject_id: "show1".to_string(),
        season: 1,
        episode: 1,
        progress_seconds: 3600,
        duration_seconds: Some(3600),
        completed: true,
        timestamp: 2000,
    };
    fs::write(&state_file_ep1, serde_json::to_string(&ep1_state).unwrap()).unwrap();

    let ep2_state = PendingPlaybackState {
        provider: "moviebox".to_string(),
        subject_id: "show1".to_string(),
        season: 1,
        episode: 2,
        progress_seconds: 1200,
        duration_seconds: Some(3600),
        completed: false,
        timestamp: 2500,
    };
    fs::write(&state_file_ep2, serde_json::to_string(&ep2_state).unwrap()).unwrap();

    let mut manager = HistoryManager::default();
    manager.recent.push(make_history_item(
        "moviebox",
        "show1",
        "Epic Series",
        2,
        "2024",
        1,
        2,
    ));

    let modified = manager.reconcile_from_dir(&temp_dir.path);
    assert!(modified);
    assert!(manager.is_watched("moviebox", "show1", 1, 1));
    assert_eq!(manager.recent.first().unwrap().episode, 2);
    assert_eq!(manager.recent.first().unwrap().progress_seconds, 1200);

    assert!(!state_file_ep1.exists());
    assert!(!state_file_ep2.exists());
}

#[test]
fn test_movie_resume_progress_and_completion() {
    let mut movie = make_history_item("moviebox", "mb_m1", "Inception", 1, "2010", 0, 0);
    movie.duration_seconds = Some(8880);
    movie.progress_seconds = 20;
    assert!(!movie.is_in_progress());

    movie.progress_seconds = 4440;
    assert!(movie.is_in_progress());
    assert_eq!(movie.progress_percentage(), Some(50.0));
    assert_eq!(movie.formatted_progress(), "1:14:00 / 2:28:00");
    assert_eq!(movie.formatted_remaining(), Some("1h 14m left".to_string()));

    movie.progress_seconds = 8000;
    assert!(!movie.is_in_progress());
}

#[test]
fn test_episode_progress_isolation() {
    let mut manager = HistoryManager::default();
    let ep1 = make_history_item("moviebox", "show_x", "Severance", 2, "2022", 1, 1);
    let ep2 = make_history_item("moviebox", "show_x", "Severance", 2, "2022", 1, 2);
    let ep3 = make_history_item("moviebox", "show_x", "Severance", 2, "2022", 2, 1);

    manager.update_progress(ep1.clone(), 3000, Some(3000), true);
    assert!(manager.is_watched("moviebox", "show_x", 1, 1));
    assert!(!manager.is_watched("moviebox", "show_x", 1, 2));
    assert!(!manager.is_watched("moviebox", "show_x", 2, 1));

    manager.update_progress(ep2.clone(), 1500, Some(3000), false);
    assert!(manager.is_watched("moviebox", "show_x", 1, 1));
    assert!(!manager.is_watched("moviebox", "show_x", 1, 2));

    manager.update_progress(ep3.clone(), 3200, Some(3200), true);
    assert!(manager.is_watched("moviebox", "show_x", 1, 1));
    assert!(manager.is_watched("moviebox", "show_x", 2, 1));
    assert!(!manager.is_watched("moviebox", "show_x", 1, 2));

    assert_eq!(manager.recent.len(), 1);
    assert_eq!(manager.recent.first().unwrap().season, 2);
    assert_eq!(manager.recent.first().unwrap().episode, 1);
}

#[test]
fn test_update_progress_precision_preservation() {
    let mut manager = HistoryManager::default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut item = make_history_item("moviebox", "mb_m2", "Interstellar", 1, "2014", 0, 0);
    item.duration_seconds = Some(10140);
    item.progress_seconds = 5000;
    item.timestamp = now;

    manager.recent.push(item.clone());

    let lower_item = item.clone();
    manager.update_progress(lower_item, 3000, Some(10140), false);

    assert_eq!(manager.recent.first().unwrap().progress_seconds, 5000);
}

#[test]
fn test_duplicate_history_prevention_on_repeated_play() {
    let mut manager = HistoryManager::default();
    let item = make_history_item("moviebox", "mb_m3", "The Matrix", 1, "1999", 0, 0);

    manager.update_progress(item.clone(), 1200, Some(8160), false);
    manager.update_progress(item.clone(), 2400, Some(8160), false);
    manager.update_progress(item.clone(), 3600, Some(8160), false);

    assert_eq!(manager.recent.len(), 1);
    assert_eq!(manager.recent.first().unwrap().progress_seconds, 3600);
}

#[test]
fn test_corrupted_history_deserialization_recovery() {
    let malformed_json = "{ \"watched\": [\"corrupt\"], \"recent\": \"invalid_shape\" }";
    let deserialized = serde_json::from_str::<HistoryManager>(malformed_json);
    assert!(deserialized.is_err());

    let empty_json = "{}";
    let empty_manager = serde_json::from_str::<HistoryManager>(empty_json).unwrap();
    assert!(empty_manager.recent.is_empty());
}
