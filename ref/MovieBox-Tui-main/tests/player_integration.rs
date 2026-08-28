use moviebox_tui::player::format_mpv_script_opts;
use std::path::PathBuf;

#[test]
fn test_player_script_opts_windows_drive_path() {
    let win_path = PathBuf::from(r"C:\Users\Samir\AppData\Roaming\moviebox\state_123.json");
    let opts = format_mpv_script_opts("moviebox", "sub_456", 1, 3, &win_path);
    assert!(!opts.contains(r"\"));
    assert!(opts.contains("moviebox-provider=moviebox"));
    assert!(opts.contains("moviebox-subject_id=sub_456"));
    assert!(opts.contains("moviebox-season=1"));
    assert!(opts.contains("moviebox-episode=3"));
    assert!(
        opts.contains("moviebox-state_file=C:/Users/Samir/AppData/Roaming/moviebox/state_123.json")
    );
}

#[test]
fn test_player_script_opts_unix_path_with_spaces() {
    let unix_path =
        PathBuf::from("/Users/User Name/Library/Application Support/MovieBox-Tui/state.json");
    let opts = format_mpv_script_opts("addons", "tt1234567", 0, 0, &unix_path);
    assert!(opts.contains("moviebox-provider=addons"));
    assert!(opts.contains("moviebox-subject_id=tt1234567"));
    assert!(opts.contains(
        "moviebox-state_file=/Users/User Name/Library/Application Support/MovieBox-Tui/state.json"
    ));
}
