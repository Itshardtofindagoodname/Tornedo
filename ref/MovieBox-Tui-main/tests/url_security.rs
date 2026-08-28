use moviebox_tui::download::safe_file_stem;
use moviebox_tui::tui::text::is_http_url;

#[test]
fn test_is_http_url_validation() {
    assert!(is_http_url("http://example.com/stream.m3u8"));
    assert!(is_http_url("https://example.com/stream.m3u8"));
    assert!(is_http_url("  https://secure.example.com/path  "));

    assert!(!is_http_url("file:///etc/passwd"));
    assert!(!is_http_url("ftp://server/file.mp4"));
    assert!(!is_http_url("javascript:alert(1)"));
    assert!(!is_http_url(""));
}

#[test]
fn test_safe_file_stem_sanitization() {
    assert_eq!(safe_file_stem("../../../etc/passwd"), "etc_passwd");
    assert_eq!(
        safe_file_stem("C:\\Windows\\System32\\calc.exe"),
        "C__Windows_System32_calc.exe"
    );

    assert_eq!(safe_file_stem("CON"), "CON_");
    assert_eq!(safe_file_stem("con"), "con_");
    assert_eq!(safe_file_stem("PRN"), "PRN_");
    assert_eq!(safe_file_stem("AUX"), "AUX_");
    assert_eq!(safe_file_stem("NUL"), "NUL_");
    assert_eq!(safe_file_stem("COM1"), "COM1_");
    assert_eq!(safe_file_stem("LPT9"), "LPT9_");

    assert_eq!(
        safe_file_stem("Movie: The <Ultimate> Edition *?|"),
        "Movie_ The _Ultimate_ Edition"
    );
}
