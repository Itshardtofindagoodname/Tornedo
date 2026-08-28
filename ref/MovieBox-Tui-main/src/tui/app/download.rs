use super::App;
use crate::providers::models::ProviderKind;
use crate::tui::{action::Action, overlay::NotificationKind, state::Screen};

impl App {
    pub(super) fn resolve_download_base_dir(&self) -> std::path::PathBuf {
        crate::service::resolve_download_dir(self.state.download_dir.as_deref())
    }

    pub(super) fn start_resilient_download(
        &mut self,
        subtitle_url: Option<String>,
        link: Option<String>,
    ) {
        if self.state.download_progress.is_some() || self.state.active_screen != Screen::Details {
            return;
        }
        let Some(link) = link else {
            if self.state.is_fetching_streams {
                self.state.is_waiting_for_download_stream = true;
                self.state.notify(
                    NotificationKind::Info,
                    "Preparing download",
                    "Waiting for stream details.",
                );
            } else {
                self.state.notify(
                    NotificationKind::Warning,
                    "Download unavailable",
                    "Select a downloadable stream first.",
                );
            }
            return;
        };

        let raw_title = self
            .state
            .selected_details
            .as_ref()
            .and_then(|details| details.get("title"))
            .and_then(|title| title.as_str())
            .unwrap_or(crate::download::DEFAULT_STREAM_NAME);
        let clean_title = crate::providers::moviebox::clean_moviebox_title(raw_title);
        let is_series = self
            .state
            .selected_details
            .as_ref()
            .map(crate::tui::state::stype)
            .is_some_and(|s| s == 2)
            || !self.state.available_seasons.is_empty();
        let season = self.state.selected_season;
        let episode = self.state.selected_episode;
        let safe_title = clean_title
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                    c
                } else {
                    ' '
                }
            })
            .collect::<String>();
        let safe_title = safe_title.split_whitespace().collect::<Vec<_>>().join(" ");
        let safe_title = if safe_title.is_empty() {
            crate::download::DEFAULT_STREAM_NAME.to_string()
        } else {
            safe_title
        };

        let extension = link
            .split('?')
            .next()
            .and_then(|path| path.rsplit('.').next())
            .filter(|ext| {
                let lower = ext.to_ascii_lowercase();
                matches!(lower.as_str(), "mp4" | "mkv" | "webm" | "ts")
            })
            .unwrap_or("mp4")
            .to_ascii_lowercase();

        let base_dir = self.resolve_download_base_dir();
        let (target_dir, base_name) = if is_series {
            (
                base_dir
                    .join("Series")
                    .join(&safe_title)
                    .join(format!("Season {season}")),
                format!("{safe_title} - S{season:02}E{episode:02}"),
            )
        } else {
            (
                base_dir.join("Movies").join(&safe_title),
                safe_title.clone(),
            )
        };
        let destination = target_dir.join(format!("{base_name}.{extension}"));
        if is_media_already_downloaded(&target_dir, &base_name) {
            self.state.is_waiting_for_download_stream = false;
            self.state.notify(
                NotificationKind::Warning,
                "Already downloaded",
                format!("{base_name} already exists on disk."),
            );
            return;
        }

        let sub_lang = self
            .state
            .last_download_subtitle_language
            .take()
            .or_else(|| self.state.season_subtitle_preference.clone().flatten());

        self.state.is_waiting_for_download_stream = false;
        self.state.download_status = Some("Preparing download...".into());
        self.state.download_progress = Some(0.0);
        self.state
            .cancel_download
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.state.notify(
            NotificationKind::Info,
            "Download started",
            "Partial data will be preserved.",
        );

        let cancel = self.state.cancel_download.clone();
        let sender = self.action_sender.clone();
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .tcp_keepalive(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|err| {
                log::warn!(
                    "failed to build custom download client ({err}), falling back to default"
                );
                self.service.http_client().clone()
            });

        tokio::spawn(async move {
            if let Err(error) = tokio::fs::create_dir_all(&target_dir).await {
                sender
                    .send(Action::DownloadFailed(format!(
                        "Cannot create download directory: {error}"
                    )))
                    .ok();
                return;
            }

            if let Some(subtitle_url) = subtitle_url {
                let subtitle_extension = subtitle_url
                    .rsplit('.')
                    .next()
                    .map(|extension| extension.to_ascii_lowercase())
                    .filter(|extension| {
                        matches!(extension.as_str(), "srt" | "vtt" | "ass" | "ssa" | "sub")
                    })
                    .unwrap_or_else(|| "srt".to_string());

                let lang_code = sub_lang
                    .as_deref()
                    .and_then(crate::providers::moviebox::title::language_to_code)
                    .or_else(|| subtitle_language_from_url(&subtitle_url));

                let final_ext = if let Some(code) = lang_code {
                    format!("{code}.{subtitle_extension}")
                } else {
                    subtitle_extension
                };

                let subtitle_path = destination.with_extension(final_ext);
                let result = tokio::time::timeout(
                    std::time::Duration::from_secs(30),
                    client.get(subtitle_url).send(),
                )
                .await;
                match result {
                    Ok(Ok(response)) => match response.error_for_status() {
                        Ok(response) => match response.bytes().await {
                            Ok(bytes) => {
                                if let Err(error) = tokio::fs::write(subtitle_path, bytes).await {
                                    sender
                                        .send(Action::SetStatus(format!(
                                            "Error: subtitle write failed: {error}"
                                        )))
                                        .ok();
                                }
                            }
                            Err(error) => {
                                sender
                                    .send(Action::SetStatus(format!(
                                        "Error: subtitle download failed: {error}"
                                    )))
                                    .ok();
                            }
                        },
                        Err(error) => {
                            sender
                                .send(Action::SetStatus(format!(
                                    "Error: subtitle download failed: {error}"
                                )))
                                .ok();
                        }
                    },
                    Ok(Err(error)) => {
                        sender
                            .send(Action::SetStatus(format!(
                                "Error: subtitle download failed: {error}"
                            )))
                            .ok();
                    }
                    Err(_) => {
                        sender
                            .send(Action::SetStatus(
                                "Error: subtitle download timed out".to_string(),
                            ))
                            .ok();
                    }
                }
            }

            let progress_sender = sender.clone();
            let result =
                crate::download::download(&client, &link, &destination, cancel, move |progress| {
                    let total = progress.total.unwrap_or_default();
                    let percentage = if total > 0 {
                        progress.downloaded as f64 / total as f64 * 100.0
                    } else {
                        0.0
                    };
                    let speed = progress.bytes_per_second / 1024.0 / 1024.0;
                    let eta = if total > progress.downloaded && progress.bytes_per_second > 0.0 {
                        (total - progress.downloaded) as f64 / progress.bytes_per_second
                    } else {
                        0.0
                    };
                    let status = if total > 0 {
                        format!(
                            "{:.1}/{:.1} MB | {:.1} MB/s | ETA {:.0}s | {}x | attempt {}",
                            progress.downloaded as f64 / 1024.0 / 1024.0,
                            total as f64 / 1024.0 / 1024.0,
                            speed,
                            eta,
                            progress.workers,
                            progress.attempt
                        )
                    } else {
                        format!(
                            "{:.1} MB | {:.1} MB/s | {}x | attempt {}",
                            progress.downloaded as f64 / 1024.0 / 1024.0,
                            speed,
                            progress.workers,
                            progress.attempt
                        )
                    };
                    progress_sender
                        .send(Action::UpdateDownload(Some(percentage), Some(status)))
                        .ok();
                })
                .await;

            match result {
                Ok(crate::download::DownloadOutcome::Completed { .. }) => {
                    sender
                        .send(Action::DownloadCompleted(
                            destination.to_string_lossy().into_owned(),
                        ))
                        .ok();
                }
                Ok(crate::download::DownloadOutcome::Paused { .. }) => {
                    sender
                        .send(Action::DownloadPaused(
                            destination.to_string_lossy().into_owned(),
                        ))
                        .ok();
                }
                Err(error) => {
                    sender.send(Action::DownloadFailed(error.to_string())).ok();
                }
            }
        });
    }
}

impl App {
    pub(super) async fn handle_download(&mut self, action: Action) -> Option<()> {
        match action {
            Action::DownloadStream(subtitle_url) => {
                if self.state.is_resolving_playback {
                    return None;
                }
                self.state.is_resolving_playback = true;
                if self.current_subject_provider() == ProviderKind::FourKHdHub
                    || self.current_subject_provider() == ProviderKind::Addons
                    || self.current_subject_provider().is_bdix()
                {
                    if let Some(release) = self.get_selected_release() {
                        let Some(first_mirror) = release.mirrors.first().cloned() else {
                            self.state.is_resolving_playback = false;
                            self.state.notify(
                                NotificationKind::Error,
                                "Download unavailable",
                                "No playable mirrors were found for this release.",
                            );
                            return None;
                        };
                        self.state.notify(
                            NotificationKind::Info,
                            "Preparing download",
                            "Resolving the selected mirror.",
                        );
                        let client = if release.provider == ProviderKind::Addons
                            || release.provider == ProviderKind::BdixCircleFtp
                            || release.provider == ProviderKind::BdixDhakaFlix
                        {
                            let sender_clone = self.action_sender.clone();
                            sender_clone
                                .send(Action::StartDownload(
                                    subtitle_url,
                                    Some(first_mirror.resolver_url.clone()),
                                ))
                                .ok();
                            return None;
                        } else {
                            match self.service.fourk_client.clone() {
                                Some(client) => client,
                                None => {
                                    self.state.is_resolving_playback = false;
                                    self.action_sender
                                        .send(Action::SetStatus(
                                            "Error: 4KHDHub provider is unavailable".to_string(),
                                        ))
                                        .ok();
                                    return None;
                                }
                            }
                        };
                        let sender = self.action_sender.clone();
                        tokio::spawn(async move {
                            match client.resolve_release(&release).await {
                                Ok(source) => {
                                    sender
                                        .send(Action::StartDownload(subtitle_url, Some(source.url)))
                                        .ok();
                                }
                                Err(error) => {
                                    log::error!("stream resolve failed: {error}");
                                    sender
                                        .send(Action::SetStatus(format!(
                                            "Error: Resolve failed: {error}"
                                        )))
                                        .ok();
                                }
                            }
                        });
                    } else {
                        self.action_sender
                            .send(Action::StartDownload(subtitle_url, None))
                            .ok();
                    }
                } else {
                    self.action_sender
                        .send(Action::StartDownload(
                            subtitle_url,
                            self.get_selected_link(),
                        ))
                        .ok();
                }
                return None;
            }
            Action::StartDownload(subtitle_url, link) => {
                self.state.is_resolving_playback = false;
                self.start_resilient_download(subtitle_url, link);
                return None;
            }
            Action::PromptDownloadEpisode => {
                self.state.show_episode_download_confirm = true;
                self.state.episode_download_confirm_yes_selected = false;
            }

            Action::ConfirmDownloadEpisode => {
                self.state.show_episode_download_confirm = false;

                let subject_id = self.state.active_subject_id.clone().unwrap_or_default();
                let resource_id = self.get_selected_resource_id();

                if let Some(rid) = resource_id {
                    self.state.notify(
                        NotificationKind::Info,
                        "Preparing download",
                        "Fetching subtitles.",
                    );
                    let client = self.service.client.clone();
                    let sender = self.action_sender.clone();
                    tokio::spawn(async move {
                        if let Ok(res) = client.get_ext_captions(&subject_id, &rid).await {
                            sender.send(Action::ShowDownloadSubtitlePopup(res)).ok();
                        } else {
                            sender.send(Action::DownloadStream(None)).ok();
                        }
                    });
                } else {
                    self.action_sender.send(Action::DownloadStream(None)).ok();
                }
            }

            Action::PromptDownloadSeason => {
                self.state.show_season_download_confirm = true;
                self.state.season_download_confirm_yes_selected = false;
            }

            Action::ConfirmDownloadSeason => {
                self.state.show_season_download_confirm = false;
                self.state.season_subtitle_preference = None;
                let season_num = self.state.selected_season;

                let season_array_idx = self.state.available_seasons.iter().position(|s| {
                    s.get("se").and_then(|v| v.as_i64()).unwrap_or(0) as usize == season_num
                });

                if let Some(idx) = season_array_idx {
                    if idx < self.state.available_episode_numbers.len() {
                        let ep_numbers = self.state.available_episode_numbers[idx].clone();
                        self.state.download_queue.clear();

                        for ep in ep_numbers {
                            self.state.download_queue.push_back((season_num, ep));
                        }
                        self.state.download_queue_total = self.state.download_queue.len();
                        self.action_sender.send(Action::ProcessDownloadQueue).ok();
                    }
                }
            }

            Action::ProcessDownloadQueue => {
                if self.state.download_progress.is_some() {
                    return None;
                }

                if let Some((season, episode)) = self.state.download_queue.pop_front() {
                    self.state.selected_season = season;
                    self.state.selected_episode = episode;
                    let remaining = self.state.download_queue.len();
                    let total = self.state.download_queue_total;
                    let num = total - remaining;

                    let raw_title = self
                        .state
                        .selected_details
                        .as_ref()
                        .and_then(|details| details.get("title"))
                        .and_then(|title| title.as_str())
                        .unwrap_or(crate::download::DEFAULT_STREAM_NAME);
                    let clean_title = crate::providers::moviebox::clean_moviebox_title(raw_title);
                    let safe_title = clean_title
                        .chars()
                        .map(|c| {
                            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                                c
                            } else {
                                ' '
                            }
                        })
                        .collect::<String>();
                    let safe_title = safe_title.split_whitespace().collect::<Vec<_>>().join(" ");
                    let safe_title = if safe_title.is_empty() {
                        crate::download::DEFAULT_STREAM_NAME.to_string()
                    } else {
                        safe_title
                    };

                    let base_dir = self.resolve_download_base_dir();
                    let target_dir = base_dir
                        .join("Series")
                        .join(&safe_title)
                        .join(format!("Season {season}"));
                    let base_name = format!("{safe_title} - S{season:02}E{episode:02}");

                    if is_media_already_downloaded(&target_dir, &base_name) {
                        self.state.notify(
                            NotificationKind::Info,
                            "Skipping episode",
                            format!(
                                "S{season:02}E{episode:02} already downloaded ({num}/{total})."
                            ),
                        );
                        self.action_sender.send(Action::ProcessDownloadQueue).ok();
                        return None;
                    }

                    self.state.notify(
                        NotificationKind::Info,
                        "Preparing episode",
                        format!("S{season:02}E{episode:02} · {num}/{total}"),
                    );

                    let subject_id = self.state.active_subject_id.clone().unwrap_or_default();

                    self.state.selected_resources = None;
                    self.state.is_fetching_streams = true;

                    self.action_sender
                        .send(Action::FetchEpisodeStreams {
                            subject_id,
                            season,
                            episode,
                            force_refresh: false,
                        })
                        .ok();

                    self.action_sender.send(Action::DownloadStream(None)).ok();
                } else if self.state.download_queue_total > 0 {
                    self.state.notify(
                        NotificationKind::Success,
                        "Season downloaded",
                        format!("{} files completed.", self.state.download_queue_total),
                    );
                    self.state.download_queue_total = 0;
                }
            }

            Action::UpdateDownload(prog, stat) => {
                if self.state.download_progress != prog || self.state.download_status != stat {
                    self.state.download_progress = prog;
                    self.state.download_status = stat;
                    self.state.dirty = true;
                }
            }
            Action::DownloadCompleted(path) => {
                self.state.download_progress = Some(100.0);
                self.state.download_status = Some("Completed".into());
                self.state.notify(
                    NotificationKind::Success,
                    "Download complete",
                    format!("Saved to {path}"),
                );
                let sender = self.action_sender.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    sender.send(Action::ClearDownload).ok();
                });
            }
            Action::DownloadFailed(error) => {
                self.state.download_progress = None;
                self.state.download_status = None;
                if self.state.download_queue_total > 0 {
                    let total = self.state.download_queue_total;
                    let remaining = self.state.download_queue.len();
                    let completed = total.saturating_sub(remaining + 1);
                    self.state.notify(
                        NotificationKind::Error,
                        "Season download halted",
                        format!("{completed}/{total} files finished before error: {error}"),
                    );
                } else {
                    self.state.notify(
                        NotificationKind::Error,
                        "Download failed",
                        format!("Partial file preserved. {error}"),
                    );
                }
                self.state.download_queue.clear();
                self.state.download_queue_total = 0;
            }
            Action::DownloadPaused(path) => {
                self.state.download_progress = None;
                self.state.download_status = None;
                if self.state.download_queue_total > 0 {
                    let total = self.state.download_queue_total;
                    let remaining = self.state.download_queue.len();
                    let completed = total.saturating_sub(remaining + 1);
                    self.state.notify(
                        NotificationKind::Warning,
                        "Season download paused",
                        format!("{completed}/{total} files finished. Resume with {path}.part"),
                    );
                } else {
                    self.state.notify(
                        NotificationKind::Warning,
                        "Download paused",
                        format!("Start again to resume {path}.part"),
                    );
                }
                self.state.download_queue.clear();
                self.state.download_queue_total = 0;
            }
            Action::ClearDownload => {
                self.state.download_progress = None;
                self.state.download_status = None;
                if !self.state.download_queue.is_empty() {
                    self.action_sender.send(Action::ProcessDownloadQueue).ok();
                } else if self.state.download_queue_total > 0 {
                    self.state.notify(
                        NotificationKind::Success,
                        "Season downloaded",
                        format!("{} files completed.", self.state.download_queue_total),
                    );
                    self.state.download_queue_total = 0;
                }
            }
            Action::CancelDownload => {
                self.state
                    .cancel_download
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                self.state.download_status = Some("Cancelling...".to_string());
                self.state.notify(
                    NotificationKind::Warning,
                    "Cancelling download",
                    "Partial data will be preserved.",
                );
            }
            _ => return None,
        }
        None
    }
}

fn subtitle_language_from_url(url: &str) -> Option<&'static str> {
    let lower = url.to_lowercase();
    if lower.contains(".en.")
        || lower.contains("_en.")
        || lower.contains("/en/")
        || lower.contains("english")
    {
        Some("en")
    } else if lower.contains(".es.")
        || lower.contains("_es.")
        || lower.contains("/es/")
        || lower.contains("spanish")
    {
        Some("es")
    } else if lower.contains(".hi.")
        || lower.contains("_hi.")
        || lower.contains("/hi/")
        || lower.contains("hindi")
    {
        Some("hi")
    } else if lower.contains(".fr.")
        || lower.contains("_fr.")
        || lower.contains("/fr/")
        || lower.contains("french")
    {
        Some("fr")
    } else if lower.contains(".de.")
        || lower.contains("_de.")
        || lower.contains("/de/")
        || lower.contains("german")
    {
        Some("de")
    } else if lower.contains(".ar.")
        || lower.contains("_ar.")
        || lower.contains("/ar/")
        || lower.contains("arabic")
    {
        Some("ar")
    } else if lower.contains(".pt.")
        || lower.contains("_pt.")
        || lower.contains("/pt/")
        || lower.contains("portuguese")
    {
        Some("pt")
    } else if lower.contains(".ru.")
        || lower.contains("_ru.")
        || lower.contains("/ru/")
        || lower.contains("russian")
    {
        Some("ru")
    } else if lower.contains(".ja.")
        || lower.contains("_ja.")
        || lower.contains("/ja/")
        || lower.contains("japanese")
    {
        Some("ja")
    } else if lower.contains(".ko.")
        || lower.contains("_ko.")
        || lower.contains("/ko/")
        || lower.contains("korean")
    {
        Some("ko")
    } else if lower.contains(".zh.")
        || lower.contains("_zh.")
        || lower.contains("/zh/")
        || lower.contains("chinese")
    {
        Some("zh")
    } else if lower.contains(".it.")
        || lower.contains("_it.")
        || lower.contains("/it/")
        || lower.contains("italian")
    {
        Some("it")
    } else if lower.contains(".bn.")
        || lower.contains("_bn.")
        || lower.contains("/bn/")
        || lower.contains("bengali")
    {
        Some("bn")
    } else {
        None
    }
}

fn is_media_already_downloaded(target_dir: &std::path::Path, base_name: &str) -> bool {
    let extensions = ["mp4", "mkv", "webm", "ts"];
    for ext in extensions {
        let final_file = target_dir.join(format!("{base_name}.{ext}"));
        if final_file.exists() {
            let part_json = target_dir.join(format!("{base_name}.{ext}.part.json"));
            let part_file = target_dir.join(format!("{base_name}.{ext}.part"));
            let part_0 = target_dir.join(format!("{base_name}.{ext}.part.0"));
            if !part_json.exists() && !part_file.exists() && !part_0.exists() {
                if let Ok(metadata) = std::fs::metadata(&final_file) {
                    if metadata.len() > 1024 * 1024 {
                        return true;
                    }
                }
            }
        }
    }
    false
}
