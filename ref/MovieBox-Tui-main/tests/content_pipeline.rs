use moviebox_tui::{
    providers::{
        addons::{
            adapter::{meta_detail_to_moviebox_json, metas_to_moviebox_search_json},
            models::{MetaDetail, MetaItem, MetaVideo},
        },
        models::{ProviderKind, RequestContext},
    },
    tui::{
        action::Action,
        app::App,
        state::{AppMode, InputMode, Screen},
    },
};

#[test]
fn test_search_result_identity_and_similar_title_isolation() {
    let metas = vec![
        MetaItem {
            id: "tt0096895".to_string(),
            r#type: "movie".to_string(),
            name: "Batman".to_string(),
            title: None,
            poster: Some("https://example.com/batman1989.jpg".to_string()),
            cover: None,
            description: Some(
                "The Dark Knight of Gotham City begins his war on crime.".to_string(),
            ),
            overview: None,
            synopsis: None,
            release_info: Some("1989".to_string()),
            year: Some("1989".to_string()),
            released: None,
            imdb_rating: Some("7.5".to_string()),
            rating: None,
            genres: vec!["Action".to_string(), "Adventure".to_string()],
            genre: vec![],
        },
        MetaItem {
            id: "tt1877830".to_string(),
            r#type: "movie".to_string(),
            name: "The Batman".to_string(),
            title: None,
            poster: Some("https://example.com/thebatman2022.jpg".to_string()),
            cover: None,
            description: Some("In his second year of fighting crime...".to_string()),
            overview: None,
            synopsis: None,
            release_info: Some("2022".to_string()),
            year: Some("2022".to_string()),
            released: None,
            imdb_rating: Some("7.8".to_string()),
            rating: None,
            genres: vec![
                "Action".to_string(),
                "Crime".to_string(),
                "Drama".to_string(),
            ],
            genre: vec![],
        },
        MetaItem {
            id: "tt0103359".to_string(),
            r#type: "series".to_string(),
            name: "Batman: The Animated Series".to_string(),
            title: None,
            poster: Some("https://example.com/batman_tas.jpg".to_string()),
            cover: None,
            description: Some("The Caped Crusader battles Gotham City criminals.".to_string()),
            overview: None,
            synopsis: None,
            release_info: Some("1992-1995".to_string()),
            year: Some("1992".to_string()),
            released: None,
            imdb_rating: Some("9.0".to_string()),
            rating: None,
            genres: vec!["Animation".to_string(), "Action".to_string()],
            genre: vec![],
        },
    ];

    let search_json = metas_to_moviebox_search_json(metas);
    let subjects = search_json
        .get("results")
        .and_then(|r| r.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("subjects"))
        .and_then(|s| s.as_array())
        .expect("subjects array must exist");

    assert_eq!(subjects.len(), 3);

    assert_eq!(subjects[0]["subjectId"], "tt0096895");
    assert_eq!(subjects[0]["title"], "Batman");
    assert_eq!(subjects[0]["subjectType"], 1);
    assert_eq!(subjects[0]["releaseDate"], "1989");

    assert_eq!(subjects[1]["subjectId"], "tt1877830");
    assert_eq!(subjects[1]["title"], "The Batman");
    assert_eq!(subjects[1]["subjectType"], 1);
    assert_eq!(subjects[1]["releaseDate"], "2022");

    assert_eq!(subjects[2]["subjectId"], "tt0103359");
    assert_eq!(subjects[2]["title"], "Batman: The Animated Series");
    assert_eq!(subjects[2]["subjectType"], 2);
    assert_eq!(subjects[2]["releaseDate"], "1992");
}

#[tokio::test]
async fn test_stale_details_response_protection() {
    let mut app = App::new();
    app.state_mut().update_available = None;
    app.state_mut().active_provider = ProviderKind::MovieBox;
    app.state_mut().active_screen = Screen::Details;

    let context_a = RequestContext {
        provider: ProviderKind::MovieBox,
        generation: app.state().provider_generation,
    };
    app.state_mut().active_details_request = 1;
    app.state_mut().active_subject_id = Some("movie_a".to_string());
    app.state_mut().selected_details = Some(serde_json::json!({
        "id": "movie_a",
        "title": "Movie A",
    }));

    let context_b = RequestContext {
        provider: ProviderKind::MovieBox,
        generation: app.state().provider_generation,
    };
    app.state_mut().active_details_request = 2;
    app.state_mut().active_subject_id = Some("movie_b".to_string());
    app.state_mut().selected_details = Some(serde_json::json!({
        "id": "movie_b",
        "title": "Movie B Draft",
    }));

    let stale_payload = serde_json::json!({
        "id": "movie_a",
        "title": "Movie A Full Metadata",
        "synopsis": "Stale synopsis from Movie A",
    });
    app.handle_action(Action::DetailsSuccess(
        context_a,
        1,
        "movie_a".to_string(),
        stale_payload,
    ))
    .await;

    assert_eq!(app.state().active_subject_id.as_deref(), Some("movie_b"));
    assert_eq!(
        app.state().selected_details.as_ref().unwrap()["title"],
        "Movie B Draft"
    );

    let valid_payload = serde_json::json!({
        "id": "movie_b",
        "title": "Movie B Full Metadata",
        "synopsis": "Correct synopsis for Movie B",
    });
    app.handle_action(Action::DetailsSuccess(
        context_b,
        2,
        "movie_b".to_string(),
        valid_payload,
    ))
    .await;

    assert_eq!(app.state().active_subject_id.as_deref(), Some("movie_b"));
    assert_eq!(
        app.state().selected_details.as_ref().unwrap()["title"],
        "Movie B Full Metadata"
    );
    assert_eq!(
        app.state().selected_details.as_ref().unwrap()["synopsis"],
        "Correct synopsis for Movie B"
    );
}

#[test]
fn test_cache_key_isolation_across_providers_queries_and_dimensions() {
    use moviebox_tui::cache::{
        get_provider_details_path, get_provider_search_path, get_provider_stream_path,
    };

    let search_mb_batman_p1 = get_provider_search_path(ProviderKind::MovieBox, "batman", 1);
    let search_mb_batman_p2 = get_provider_search_path(ProviderKind::MovieBox, "batman", 2);
    let search_mb_superman_p1 = get_provider_search_path(ProviderKind::MovieBox, "superman", 1);
    let search_addon_batman_p1 = get_provider_search_path(ProviderKind::Addons, "batman", 1);

    assert_ne!(search_mb_batman_p1, search_mb_batman_p2);
    assert_ne!(search_mb_batman_p1, search_mb_superman_p1);
    assert_ne!(search_mb_batman_p1, search_addon_batman_p1);

    let details_mb_1 = get_provider_details_path(ProviderKind::MovieBox, "1001");
    let details_mb_2 = get_provider_details_path(ProviderKind::MovieBox, "1002");
    let details_4k_1 = get_provider_details_path(ProviderKind::FourKHdHub, "1001");

    assert_ne!(details_mb_1, details_mb_2);
    assert_ne!(details_mb_1, details_4k_1);

    let stream_s1_e1 = get_provider_stream_path(ProviderKind::MovieBox, "series_1", 1, 1);
    let stream_s1_e2 = get_provider_stream_path(ProviderKind::MovieBox, "series_1", 1, 2);
    let stream_s2_e1 = get_provider_stream_path(ProviderKind::MovieBox, "series_1", 2, 1);

    assert_ne!(stream_s1_e1, stream_s1_e2);
    assert_ne!(stream_s1_e1, stream_s2_e1);
}

#[test]
fn test_addon_metadata_mapping_and_partial_data_degradation() {
    let minimal = MetaDetail {
        id: "tt9999999".to_string(),
        r#type: "movie".to_string(),
        name: "Minimal Indie Film".to_string(),
        title: None,
        poster: None,
        cover: None,
        background: None,
        logo: None,
        description: None,
        overview: None,
        synopsis: None,
        release_info: None,
        year: None,
        released: None,
        imdb_rating: None,
        rating: None,
        genres: vec![],
        genre: vec![],
        runtime: None,
        cast: vec![],
        director: vec![],
        videos: vec![],
    };

    let json_output = meta_detail_to_moviebox_json(&minimal);

    assert_eq!(json_output["id"], "tt9999999");
    assert_eq!(json_output["title"], "Minimal Indie Film");
    assert_eq!(json_output["subjectType"], 1);
    assert_eq!(json_output["releaseDate"], "");
    assert!(json_output["description"].is_null());
    assert!(json_output["director"].is_null());
    assert!(json_output["stars"].is_null());

    let series_detail = MetaDetail {
        id: "tt8888888".to_string(),
        r#type: "series".to_string(),
        name: "Test Drama".to_string(),
        title: None,
        poster: Some("https://example.com/poster.jpg".to_string()),
        cover: None,
        background: None,
        logo: None,
        description: Some("A gripping story.".to_string()),
        overview: None,
        synopsis: None,
        release_info: Some("2021".to_string()),
        year: Some("2021".to_string()),
        released: None,
        imdb_rating: Some("8.4".to_string()),
        rating: None,
        genres: vec!["Drama".to_string()],
        genre: vec![],
        runtime: Some("45 min".to_string()),
        cast: vec!["Actor One".to_string(), "Actor Two".to_string()],
        director: vec!["Director Name".to_string()],
        videos: vec![
            MetaVideo {
                id: Some("ep1".to_string()),
                title: Some("Pilot".to_string()),
                name: None,
                season: Some(1),
                episode: Some(1),
                number: Some(1),
                released: None,
                thumbnail: None,
            },
            MetaVideo {
                id: Some("ep2".to_string()),
                title: Some("Chapter 2".to_string()),
                name: None,
                season: Some(1),
                episode: Some(2),
                number: Some(2),
                released: None,
                thumbnail: None,
            },
            MetaVideo {
                id: Some("ep3".to_string()),
                title: Some("Season 2 Premiere".to_string()),
                name: None,
                season: Some(2),
                episode: Some(1),
                number: Some(1),
                released: None,
                thumbnail: None,
            },
        ],
    };

    let series_json = meta_detail_to_moviebox_json(&series_detail);

    assert_eq!(series_json["subjectType"], 2);
    assert_eq!(series_json["releaseDate"], "2021");
    assert_eq!(series_json["director"], "Director Name");
    assert_eq!(series_json["stars"], "Actor One, Actor Two");

    let seasons = series_json["seasons"]["seasons"]
        .as_array()
        .expect("seasons array");
    assert_eq!(seasons.len(), 2);
    assert_eq!(seasons[0]["se"], 1);
    assert_eq!(seasons[0]["maxEp"], 2);
    assert_eq!(seasons[1]["se"], 2);
    assert_eq!(seasons[1]["maxEp"], 1);
}

#[tokio::test]
async fn test_search_failure_vs_empty_result_distinction() {
    let mut app = App::new();
    app.state_mut().update_available = None;
    app.state_mut().active_provider = ProviderKind::MovieBox;
    app.state_mut().input_mode = InputMode::Normal;
    app.state_mut().search_query = "xyznonexistent".to_string();

    let context = RequestContext {
        provider: ProviderKind::MovieBox,
        generation: app.state().provider_generation,
    };

    app.handle_action(Action::SearchSuccess {
        context,
        request_id: app.state().active_search_request,
        query: "xyznonexistent".to_string(),
        page: 1,
        payload: serde_json::json!({
            "results": [{
                "subjects": []
            }]
        }),
    })
    .await;

    assert!(app.state().search_results.is_empty());
    assert!(app.state().search_error.is_none());
    assert!(!app.state().is_loading);

    app.handle_action(Action::SearchFailure(
        context,
        app.state().active_search_request,
        1,
        "Network connection reset by peer".to_string(),
    ))
    .await;

    assert!(app.state().search_results.is_empty());
    assert_eq!(
        app.state().search_error.as_deref(),
        Some("Network connection reset by peer")
    );
    assert!(!app.state().is_loading);
}

#[tokio::test]
async fn test_mode_switch_stale_response_protection() {
    let mut app = App::new();
    app.state_mut().update_available = None;
    app.state_mut().set_mode(AppMode::Streaming);

    let streaming_generation = app.state().provider_generation;
    let streaming_context = RequestContext {
        provider: ProviderKind::MovieBox,
        generation: streaming_generation,
    };
    app.state_mut().active_search_request = 1;
    app.state_mut().search_query = "avatar".to_string();

    app.handle_action(Action::ToggleAddonMode).await;
    assert_eq!(app.state().mode(), AppMode::Addon);
    assert_ne!(app.state().provider_generation, streaming_generation);

    let moviebox_payload = serde_json::json!({
        "results": [{
            "subjects": [{
                "subjectId": "mb_12345",
                "title": "Avatar",
                "subjectType": 1,
                "releaseDate": "2009",
                "cover": { "url": "https://example.com/avatar.jpg" }
            }]
        }]
    });

    app.handle_action(Action::SearchSuccess {
        context: streaming_context,
        request_id: 1,
        query: "avatar".to_string(),
        page: 1,
        payload: moviebox_payload,
    })
    .await;

    assert!(app.state().search_results.is_empty());
}

#[tokio::test]
async fn test_poster_identity_isolation() {
    let mut app = App::new();
    app.state_mut().update_available = None;
    app.state_mut().active_screen = Screen::Details;
    app.state_mut().active_subject_id = Some("target_movie_id".to_string());
    app.state_mut().poster_image = None;

    let dynamic_img = std::sync::Arc::new(image::DynamicImage::new_rgb8(10, 10));

    app.handle_action(Action::PosterSuccess(
        "other_movie_id".to_string(),
        dynamic_img.clone(),
    ))
    .await;

    assert!(app.state().poster_image.is_none());

    app.handle_action(Action::PosterSuccess(
        "target_movie_id".to_string(),
        dynamic_img.clone(),
    ))
    .await;

    assert!(app.state().poster_image.is_some());
}
