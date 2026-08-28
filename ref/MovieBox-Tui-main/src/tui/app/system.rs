use super::App;
use crate::tui::{action::Action, overlay::NotificationKind, state::Screen};

impl App {
    pub(super) async fn handle_system(&mut self, action: Action) -> Option<()> {
        match action {
            Action::Tick => {
                let mut needs_redraw = (self.state.is_loading && self.state.tick_count % 5 == 0)
                    || self.state.tick_count < 15;
                self.state.tick_count = self.state.tick_count.wrapping_add(1);
                if !self.state.notifications.is_empty() {
                    needs_redraw = true;
                    self.state.expire_notifications();
                }
                if self.state.status_timer > 0 {
                    needs_redraw = true;
                    self.state.status_timer -= 1;
                    if self.state.status_timer == 0 {
                        self.state.status_message.clear();
                    }
                }
                if let Some((time, _, _)) = self.state.last_resize_time {
                    needs_redraw = true;
                    if time.elapsed() >= std::time::Duration::from_millis(300) {
                        self.state.last_resize_time = None;
                        self.state.clear_terminal_before_draw = true;
                        self.state.poster_protocol = None;
                        self.state.search_poster_protocols.clear();
                    }
                }
                if needs_redraw {
                    self.state.dirty = true;
                }

                let current_query = self.state.search_query.trim().to_string();
                if current_query != self.state.last_suggest_query
                    && self.state.last_search_edit.elapsed()
                        >= std::time::Duration::from_millis(350)
                {
                    self.state.last_suggest_query = current_query.clone();
                    if !current_query.is_empty() {
                        if self.state.is_tv_mode && !current_query.starts_with('/') {
                            let q = current_query.to_lowercase();
                            self.state.search_suggestions = self
                                .state
                                .tv_channels
                                .iter()
                                .filter(|c| c.name.to_lowercase().contains(&q))
                                .take(10)
                                .map(|c| c.name.clone())
                                .collect();
                        } else {
                            self.action_sender.send(Action::Suggest(current_query)).ok();
                        }
                    } else {
                        self.state.search_suggestions.clear();
                    }
                }

                if self.state.pending_episode_fetch.is_some()
                    && self.state.last_episode_nav.elapsed()
                        >= std::time::Duration::from_millis(300)
                {
                    if let Some((subject_id, se, ep)) = self.state.pending_episode_fetch.take() {
                        let mut found_cached = false;
                        if let Some(pool) = self.state.stream_pool.get(&subject_id) {
                            if let Some(cached) = pool.episode_index.get(&(se, ep)) {
                                found_cached = true;
                                let count = cached.len();
                                let mut result = serde_json::Map::new();
                                result.insert(
                                    "list".to_string(),
                                    serde_json::Value::Array(cached.clone()),
                                );
                                self.state.selected_resources =
                                    Some(serde_json::Value::Object(result));
                                self.state.is_loading = false;
                                self.state.resource_list_state.select(if count > 0 {
                                    Some(0)
                                } else {
                                    None
                                });
                                self.state.set_status(
                                    format!("Resolved {} direct stream sources (cached).", count),
                                    150,
                                );
                            }
                        }

                        if !found_cached {
                            self.action_sender
                                .send(Action::FetchEpisodeStreams {
                                    subject_id,
                                    season: se,
                                    episode: ep,
                                    force_refresh: false,
                                })
                                .ok();
                        }
                    }
                }
            }

            Action::FocusChange => {
                self.prepare_image_soft_refresh();
            }

            Action::Resize(w, h) => {
                self.state.last_resize_time = Some((std::time::Instant::now(), w, h));
                self.state.poster_protocol = None;
                self.state.search_poster_protocols.clear();
                self.state.clear_terminal_before_draw = true;
                self.state.dirty = true;
            }

            Action::SwitchProvider(provider) => self.switch_provider(provider),

            Action::ToggleHelp => {
                if matches!(self.state.active_screen, Screen::Home | Screen::Details) {
                    self.state.show_help = !self.state.show_help;
                    if self.state.show_help {
                        self.state.show_theme_popup = false;
                        self.state.show_browse_popup = false;
                        self.state.tv_config_popup = false;
                        self.state.player_picker_popup = false;
                        self.state.subtitle_popup = false;
                        self.state.is_download_subtitle_popup = false;
                        self.state.show_season_download_confirm = false;
                        self.state.show_episode_download_confirm = false;
                    }
                }
            }

            Action::Refresh => match self.state.active_screen {
                Screen::Home => {
                    let query = self.state.search_query.trim().to_string();
                    if self.state.is_tv_mode {
                        self.state
                            .set_status("Reloading TV playlists...".to_string(), 150);
                        self.reload_tv_playlists();
                    } else if let Some(preset) = self.state.active_browse_preset {
                        self.state.is_loading = true;
                        self.state
                            .set_status(format!("Reloading {}...", preset.label()), 150);
                        let tab_id = if self.state.current_tab_id.is_empty() {
                            "2".to_string()
                        } else {
                            self.state.current_tab_id.clone()
                        };
                        self.action_sender
                            .send(Action::FetchHomepage { tab_id, page: 1 })
                            .ok();
                    } else if let Some(catalog) = self.state.active_addon_catalog.clone() {
                        self.action_sender
                            .send(Action::SelectAddonCatalog(catalog))
                            .ok();
                    } else if !query.is_empty() {
                        self.action_sender
                            .send(Action::Search {
                                query,
                                force_refresh: true,
                            })
                            .ok();
                    }
                }
                Screen::Details => {
                    if let Some(id) = self.state.active_subject_id.clone() {
                        let se = if self.state.available_seasons.is_empty() {
                            0
                        } else {
                            self.state.selected_season
                        };
                        let ep = if self.state.available_seasons.is_empty() {
                            0
                        } else {
                            self.state.selected_episode
                        };
                        let id_clone = id.clone();
                        let id_clone_2 = id.clone();
                        let provider = self.provider_for_subject(&id);
                        tokio::task::spawn_blocking(move || {
                            crate::cache::invalidate_provider_stream_cache(
                                provider, &id_clone, se, ep,
                            );
                            crate::cache::invalidate_provider_details_cache(provider, &id_clone_2);
                        });
                        self.state.selected_season = se;
                        self.state.selected_episode = ep;

                        self.action_sender
                            .send(Action::FetchDetails(id.clone(), true))
                            .ok();

                        self.action_sender
                            .send(Action::FetchEpisodeStreams {
                                subject_id: id,
                                season: se,
                                episode: ep,
                                force_refresh: true,
                            })
                            .ok();
                    }
                }
            },

            Action::ClearCache => {
                let sender = self.action_sender.clone();
                tokio::spawn(async move {
                    let result = tokio::task::spawn_blocking(|| {
                        crate::cache::clear_all_cache();
                        Ok::<(), String>(())
                    })
                    .await
                    .map_err(|error| format!("cache clear task failed: {error}"))
                    .and_then(|result| result);
                    sender.send(Action::CacheCleared(result)).ok();
                });
                self.state
                    .fetch_cancel
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                self.state.fetch_cancel =
                    std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                self.state.provider_generation = self.state.provider_generation.wrapping_add(1);
                self.state.active_preview_request =
                    self.state.active_preview_request.wrapping_add(1);
                self.state.active_search_request = self.state.active_search_request.wrapping_add(1);
                self.state.active_details_request =
                    self.state.active_details_request.wrapping_add(1);
                self.state.active_resource_request =
                    self.state.active_resource_request.wrapping_add(1);
                self.reset_transient_overlays();
                self.state.active_screen = Screen::Home;
                self.state.input_mode = crate::tui::state::InputMode::Normal;
                self.state.is_loading = false;
                self.state.clear_search_state();
                self.state.clear_details_state();
                self.state.stream_pool.clear();
                self.state.image_cache.clear();
                self.state.preview_cache.clear();
                if self.state.is_tv_mode {
                    self.state.tv_channels.clear();
                }
                self.prepare_image_soft_refresh();
                self.state.set_status("Clearing cache...".to_string(), 150);
                self.state.dirty = true;
            }

            Action::CacheCleared(result) => match result {
                Ok(()) => {
                    if self.state.is_tv_mode && !self.state.tv_playlists.is_empty() {
                        self.state.notify(
                            NotificationKind::Success,
                            "Cache Cleared",
                            "Temporary cache cleared. Reloading TV playlists...",
                        );
                        self.reload_tv_playlists();
                    } else {
                        self.state.notify(
                            NotificationKind::Success,
                            "Cache Cleared",
                            "All temporary cache files cleared completely.",
                        );
                    }
                }
                Err(error) => {
                    log::error!("cache clear failed: {error}");
                    self.state
                        .notify(NotificationKind::Error, "Cache Clear Failed", error);
                }
            },

            Action::ToggleThemePopup => {
                let open = !self.state.show_theme_popup;
                if open {
                    self.reset_transient_overlays();
                    self.state.tv_config_popup = false;
                    self.state.original_theme_kind = Some(self.state.active_theme_kind.clone());
                    self.state.show_theme_popup = true;
                    if let Some(idx) = crate::tui::theme::AVAILABLE_THEMES
                        .iter()
                        .position(|&t| t.eq_ignore_ascii_case(&self.state.active_theme_kind))
                    {
                        self.state.theme_list_state.select(Some(idx));
                    } else {
                        self.state.theme_list_state.select(Some(0));
                    }
                } else {
                    self.state.show_theme_popup = false;
                }
            }

            Action::ShowBrowseMenu => {
                let current_mode = self.state.mode();
                if current_mode == crate::tui::state::AppMode::Tv {
                    let ctrl_s = crate::tui::text::ctrl_key("S");
                    let ctrl_a = crate::tui::text::ctrl_key("A");
                    self.state.notify(
                        NotificationKind::Info,
                        "TV Mode",
                        format!("Command /browse is available in Streaming Mode ({ctrl_s}) or Addon Mode ({ctrl_a})."),
                    );
                } else if current_mode == crate::tui::state::AppMode::Streaming
                    && self.state.active_provider
                        != crate::providers::models::ProviderKind::MovieBox
                {
                    self.state.set_status(
                        "Browse is available only with the MovieBox provider.".to_string(),
                        180,
                    );
                } else {
                    self.reset_transient_overlays();
                    self.state.show_browse_popup = true;
                    self.state.browse_list_state.select(Some(0));
                    self.state.input_mode = crate::tui::state::InputMode::Normal;
                }
            }

            Action::SelectTheme(theme_name) => {
                let kind = crate::tui::theme::ThemeKind::parse(&theme_name);
                self.state.active_theme_kind = kind.as_str().to_string();
                self.theme = crate::tui::theme::Theme::from_kind(kind);
                if !self.state.show_theme_popup {
                    self.persist_config();
                }
                self.state.dirty = true;
            }

            Action::SetStatus(msg) => {
                self.state.is_resolving_playback = false;
                if msg.starts_with("Error:") {
                    log::error!("{msg}");
                    self.state.notify(
                        NotificationKind::Error,
                        "Operation failed",
                        msg.trim_start_matches("Error:").trim(),
                    );
                } else {
                    self.state.set_status(msg, 150);
                }
            }

            Action::CheckForUpdates => {
                if self.state.is_checking_updates {
                    return None;
                }
                self.state.is_checking_updates = true;
                let update_sender = self.action_sender.clone();
                tokio::spawn(async move {
                    let task = tokio::spawn(crate::updater::check(env!("CARGO_PKG_VERSION")));
                    let result = match task.await {
                        Ok(res) => res,
                        Err(join_err) => Err(format!("update check task error: {join_err}")),
                    };
                    update_sender.send(Action::UpdateAvailable(result)).ok();
                });
            }

            Action::UpdateAvailable(result) => {
                self.state.is_checking_updates = false;
                self.state.last_update_check = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                self.persist_config();

                match result {
                    Ok(None) => {
                        if self.state.manual_update_check {
                            self.state.set_status(
                                format!(
                                    "MovieBox-Tui is up to date (v{}).",
                                    env!("CARGO_PKG_VERSION")
                                ),
                                180,
                            );
                            self.state.notify(
                                NotificationKind::Success,
                                "Up to date",
                                format!(
                                    "MovieBox-Tui v{} is the latest version.",
                                    env!("CARGO_PKG_VERSION")
                                ),
                            );
                        }
                        self.state.manual_update_check = false;
                    }
                    Err(err) => {
                        if self.state.manual_update_check {
                            self.state
                                .set_status(format!("Update check failed: {err}"), 180);
                            self.state
                                .notify(NotificationKind::Error, "Update check failed", err);
                        }
                        self.state.manual_update_check = false;
                    }
                    Ok(Some((version, notes))) => {
                        self.state.manual_update_check = false;
                        self.reset_transient_overlays();
                        self.state.update_available = Some((version, notes));
                    }
                }
            }

            Action::StartSelfUpdate => {
                if self.state.is_updating {
                    return None;
                }
                if self.state.download_progress.is_some() {
                    self.state.notify(
                        NotificationKind::Warning,
                        "Update Deferred",
                        "Cannot perform in-app update while a download is active.",
                    );
                    return None;
                }
                if self.state.is_playing {
                    self.state.notify(
                        NotificationKind::Warning,
                        "Update Deferred",
                        "Cannot perform in-app update while playback is active.",
                    );
                    return None;
                }

                self.state.is_updating = true;
                self.state.update_available = None;
                self.state
                    .set_status("Starting self-update...".to_string(), 180);
                self.state.notify(
                    NotificationKind::Info,
                    "Self-Update",
                    "Downloading release artifact and verifying checksum...",
                );

                let update_sender = self.action_sender.clone();
                tokio::spawn(async move {
                    let release =
                        match crate::updater::check_release(env!("CARGO_PKG_VERSION")).await {
                            Ok(Some(r)) => r,
                            Ok(None) => {
                                update_sender
                                    .send(Action::SelfUpdateComplete(Err(
                                        "Already on the latest version.".to_string(),
                                    )))
                                    .ok();
                                return;
                            }
                            Err(e) => {
                                update_sender.send(Action::SelfUpdateComplete(Err(e))).ok();
                                return;
                            }
                        };

                    let (progress_tx, mut progress_rx) =
                        tokio::sync::mpsc::unbounded_channel::<String>();
                    let fwd_sender = update_sender.clone();
                    tokio::spawn(async move {
                        while let Some(msg) = progress_rx.recv().await {
                            fwd_sender.send(Action::SelfUpdateProgress(msg)).ok();
                        }
                    });

                    let outcome =
                        crate::updater::perform_self_update(&release, Some(&progress_tx)).await;
                    update_sender.send(Action::SelfUpdateComplete(outcome)).ok();
                });
            }

            Action::SelfUpdateProgress(msg) => {
                self.state.set_status(msg, 180);
            }

            Action::SelfUpdateComplete(result) => {
                self.state.is_updating = false;
                match result {
                    Ok(crate::updater::SelfUpdateOutcome::Success) => {
                        self.state
                            .set_status("Update successful! Restarting...".to_string(), 180);
                        self.state.notify(
                            NotificationKind::Success,
                            "Update Installed",
                            "MovieBox-Tui was updated successfully. Restarting process...",
                        );

                        crossterm::terminal::disable_raw_mode().ok();
                        crossterm::execute!(
                            std::io::stdout(),
                            crossterm::terminal::LeaveAlternateScreen,
                            crossterm::event::DisableMouseCapture,
                            crossterm::cursor::Show
                        )
                        .ok();

                        if let Ok(exe_path) = std::env::current_exe() {
                            let _ = crate::updater::restart_process(&exe_path);
                        }
                        std::process::exit(0);
                    }
                    Ok(crate::updater::SelfUpdateOutcome::RequiresManualUpgrade(msg)) => {
                        self.state.set_status(msg.clone(), 300);
                        self.state
                            .notify(NotificationKind::Warning, "Manual Update Required", msg);
                    }
                    Err(err) => {
                        self.state.set_status(format!("Update failed: {err}"), 240);
                        self.state
                            .notify(NotificationKind::Error, "Update Failed", err);
                    }
                }
            }
            _ => return None,
        }
        None
    }
}
