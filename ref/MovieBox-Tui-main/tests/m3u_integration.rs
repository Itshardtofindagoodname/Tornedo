use moviebox_tui::providers::tv::parser::M3UParser;

#[test]
fn test_m3u_fixture_parsing() {
    let fixture_content = include_str!("fixtures/m3u/sample_playlist.m3u");
    let parser = M3UParser::new();
    let channels = parser.parse_m3u(fixture_content);

    assert_eq!(channels.len(), 4);

    let cnn = &channels[0];
    assert_eq!(cnn.id, "cnn.us");
    assert_eq!(cnn.name, "CNN International HD");
    assert_eq!(cnn.logo, "https://example.com/cnn.png");
    assert_eq!(cnn.group, "News");
    assert_eq!(cnn.stream_url, "https://stream.example.com/cnn/live.m3u8");

    let bbc = &channels[1];
    assert_eq!(bbc.id, "bbc.uk");
    assert_eq!(bbc.name, "BBC News 24");
    assert_eq!(bbc.logo, "https://example.com/bbc.png");
    assert_eq!(bbc.group, "News");
    assert_eq!(bbc.stream_url, "https://stream.example.com/bbc/live.m3u8");

    let espn = &channels[2];
    assert_eq!(espn.id, "espn.us");
    assert_eq!(espn.name, "ESPN Main");
    assert_eq!(espn.group, "Sports");
    assert_eq!(espn.stream_url, "https://stream.example.com/espn/live.m3u8");

    let discovery = &channels[3];
    assert_eq!(discovery.id, "Discovery Channel HD");
    assert_eq!(discovery.name, "Discovery Channel HD");
    assert_eq!(
        discovery.stream_url,
        "https://stream.example.com/discovery/live.m3u8"
    );
}
