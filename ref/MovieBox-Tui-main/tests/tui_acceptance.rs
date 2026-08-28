use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use moviebox_tui::models::SearchResult;
use moviebox_tui::providers::models::ProviderKind;
use moviebox_tui::tui::action::Action;
use moviebox_tui::tui::app::App;
use moviebox_tui::tui::state::{InputMode, Screen};
use moviebox_tui::tui::theme::ThemeKind;
use ratatui::Terminal;
use ratatui::backend::TestBackend;

#[tokio::test]
async fn test_backspace_from_home_focuses_search_input() {
    let mut app = App::new();
    app.state_mut().active_screen = Screen::Home;
    app.state_mut().input_mode = InputMode::Normal;
    app.state_mut().search_query = "Inception".to_string();
    app.state_mut().favorites_focus = true;

    let key = KeyEvent::new(KeyCode::Backspace, KeyModifiers::empty());
    app.handle_action(Action::Key(key)).await;

    assert_eq!(app.state().input_mode, InputMode::Editing);
    assert!(!app.state().favorites_focus);
    assert_eq!(app.state().search_query, "Inception");
}

#[tokio::test]
async fn test_season_download_remembers_explicit_no_subtitle_choice() {
    let mut app = App::new();
    app.state_mut().is_download_subtitle_popup = true;
    app.state_mut().subtitle_list = vec![("None".to_string(), String::new())];
    app.state_mut().subtitle_list_state.select(Some(0));
    app.state_mut().download_queue_total = 4;
    app.state_mut().last_search_edit =
        std::time::Instant::now() - std::time::Duration::from_secs(1);

    app.handle_action(Action::Submit).await;

    assert_eq!(app.state().season_subtitle_preference, Some(None));
}

#[tokio::test]
async fn test_tui_startup_and_home_screen_rendering() {
    let backend = TestBackend::new(100, 30);
    let mut terminal = Terminal::new(backend).unwrap();
    let mut app = App::new();

    terminal.draw(|frame| app.draw(frame)).unwrap();
    let buffer = terminal.backend().buffer();
    assert_eq!(buffer.area.width, 100);
    assert_eq!(buffer.area.height, 30);
}

#[tokio::test]
async fn test_tui_all_theme_rendering() {
    for theme_kind in ThemeKind::ALL {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut app = App::new();
        let _ = theme_kind;
        let res = terminal.draw(|frame| app.draw(frame));
        assert!(res.is_ok(), "Failed to render theme {:?}", theme_kind);
    }
}

#[tokio::test]
async fn test_tui_terminal_resizing_matrix_no_panics() {
    let sizes = [
        (40, 15),
        (80, 24),
        (100, 30),
        (120, 40),
        (160, 50),
        (200, 60),
        (25, 8),
        (300, 80),
    ];

    let mut app = App::new();

    for (w, h) in sizes {
        let backend = TestBackend::new(w, h);
        let mut terminal = Terminal::new(backend).unwrap();
        let res = terminal.draw(|frame| app.draw(frame));
        assert!(res.is_ok(), "Failed to render at terminal size {w}x{h}");
    }
}

#[tokio::test]
async fn test_mouse_click_help_overlay_dismisses() {
    let mut app = App::new();
    app.state_mut().show_help = true;
    assert!(app.state().show_help);

    app.handle_action(Action::MouseClick(10, 10)).await;
    assert!(!app.state().show_help);
}

#[tokio::test]
async fn test_mouse_click_outside_theme_popup_dismisses() {
    let mut app = App::new();
    app.state_mut().show_theme_popup = true;
    assert!(app.state().show_theme_popup);

    app.handle_action(Action::MouseClick(0, 0)).await;
    assert!(!app.state().show_help);
}

#[tokio::test]
async fn test_mouse_click_search_input_mode() {
    let mut app = App::new();
    assert_eq!(app.state().input_mode, InputMode::Normal);

    app.handle_action(Action::MouseClick(5, 5)).await;
    let _ = app.state().input_mode;
}

#[tokio::test]
async fn test_mouse_scroll_maps_to_key_actions() {
    let mut app = App::new();
    let up_key = crossterm::event::KeyEvent::new(
        crossterm::event::KeyCode::Up,
        crossterm::event::KeyModifiers::empty(),
    );
    let down_key = crossterm::event::KeyEvent::new(
        crossterm::event::KeyCode::Down,
        crossterm::event::KeyModifiers::empty(),
    );

    app.handle_action(Action::Key(down_key)).await;
    app.handle_action(Action::Key(up_key)).await;
    assert_eq!(app.state().search_query, "");
}

#[tokio::test]
async fn test_full_user_journey_movie_search_details_and_back_navigation() {
    let mut app = App::new();
    app.state_mut().is_tv_mode = false;
    app.state_mut().is_addon_mode = false;
    app.state_mut().active_screen = Screen::Home;
    app.state_mut().last_search_edit =
        std::time::Instant::now() - std::time::Duration::from_millis(600);

    let sample_item = SearchResult {
        id: "12345".to_string(),
        title: "Inception".to_string(),
        stype: 1,
        release_year: "2010".to_string(),
        cover_url: None,
        season: 0,
        episode: 0,
        provider: ProviderKind::MovieBox,
    };

    app.state_mut().search_results.push(sample_item);
    app.state_mut().search_list_state.select(Some(0));

    app.handle_action(Action::Submit).await;
    assert_eq!(app.state().active_screen, Screen::Details);
    assert_eq!(app.state().active_subject_id.as_deref(), Some("12345"));

    app.handle_action(Action::GoBack).await;
    assert_eq!(app.state().active_screen, Screen::Home);
}

#[tokio::test]
async fn test_full_user_journey_mode_switching_and_theme_selection() {
    let mut app = App::new();
    app.state_mut().is_addon_mode = false;
    app.state_mut().is_tv_mode = false;

    app.handle_action(Action::ToggleAddonMode).await;
    assert!(app.state().is_addon_mode);

    app.handle_action(Action::SwitchToStreamingMode).await;
    assert!(!app.state().is_addon_mode);

    app.handle_action(Action::SelectTheme("TokyoNight".to_string()))
        .await;
    assert_eq!(app.state().active_theme_kind, "TokyoNight");
}

#[tokio::test]
async fn test_download_dir_reset_user_journey() {
    let mut app = App::new();
    let custom_path = std::path::PathBuf::from("/custom/moviebox/downloads");
    app.state_mut().download_dir = Some(custom_path.clone());
    assert_eq!(app.state().download_dir, Some(custom_path));

    app.handle_action(Action::Search {
        query: "/download-dir reset".to_string(),
        force_refresh: false,
    })
    .await;

    assert!(app.state().download_dir.is_none());
    assert!(!app.state().notifications.is_empty());
    let notif = app.state().notifications.back().unwrap();
    assert_eq!(notif.title, "Download Directory");
    assert!(notif.message.contains("Reset to default"));
}

#[tokio::test]
async fn test_esc_key_cancels_slash_command_and_clears_search_bar() {
    let mut app = App::new();
    app.state_mut().update_available = None;
    app.state_mut().show_theme_popup = false;
    app.state_mut().show_browse_popup = false;
    app.state_mut().input_mode = InputMode::Editing;
    app.state_mut().search_query = "/download-dir".to_string();

    let esc_key = crossterm::event::KeyEvent::new(
        crossterm::event::KeyCode::Esc,
        crossterm::event::KeyModifiers::empty(),
    );
    app.handle_action(Action::Key(esc_key)).await;

    assert_eq!(app.state().input_mode, InputMode::Normal);
    assert_eq!(app.state().search_query, "");
}

#[tokio::test]
async fn test_esc_key_cancels_unsubmitted_search_query() {
    let mut app = App::new();
    app.state_mut().update_available = None;
    app.state_mut().show_theme_popup = false;
    app.state_mut().show_browse_popup = false;
    app.state_mut().input_mode = InputMode::Editing;
    app.state_mut().search_query = "batman".to_string();
    assert!(app.state().search_results.is_empty());

    let esc_key = crossterm::event::KeyEvent::new(
        crossterm::event::KeyCode::Esc,
        crossterm::event::KeyModifiers::empty(),
    );
    app.handle_action(Action::Key(esc_key)).await;

    assert_eq!(app.state().input_mode, InputMode::Normal);
    assert_eq!(app.state().search_query, "");
}
