use super::App;
use crate::providers::addons::models::InstalledAddon;
use crate::tui::action::Action;
use crate::tui::overlay::NotificationKind;

impl App {
    pub(super) async fn handle_addons(&mut self, action: Action) -> Option<()> {
        match action {
            Action::ToggleAddonMode => {
                self.reset_mode_state();
                let will_be_addon = !self.state.is_addon_mode;
                if will_be_addon {
                    self.state.set_mode(crate::tui::state::AppMode::Addon);
                } else if self.state.streaming_enabled {
                    self.state.set_mode(crate::tui::state::AppMode::Streaming);
                } else if self.state.tv_enabled {
                    self.state.set_mode(crate::tui::state::AppMode::Tv);
                }
                if self.state.is_addon_mode {
                    self.state.active_provider = crate::providers::models::ProviderKind::Addons;
                    self.load_installed_addons_from_config();
                    if self.state.installed_addons.is_empty() {
                        self.action_sender.send(Action::ShowAddonManager).ok();
                    } else {
                        self.announce_mode();
                    }
                } else if self.state.is_tv_mode {
                    self.state.active_provider = crate::providers::models::ProviderKind::MovieBox;
                    self.announce_mode();
                    self.load_tv_playlists_from_config();
                    self.reload_tv_playlists();
                    if self.state.tv_playlists.is_empty() {
                        self.action_sender.send(Action::ShowTvConfig).ok();
                    }
                } else {
                    self.state.active_provider = crate::providers::models::ProviderKind::MovieBox;
                    self.announce_mode();
                }
                self.persist_config();
            }

            Action::SwitchToStreamingMode => {
                self.reset_mode_state();
                self.state.set_mode(crate::tui::state::AppMode::Streaming);
                if self.state.active_provider == crate::providers::models::ProviderKind::Addons {
                    self.state.active_provider = crate::providers::models::ProviderKind::MovieBox;
                }
                self.announce_mode();
                self.persist_config();
            }

            Action::ShowAddonManager => {
                self.reset_transient_overlays();
                self.state.addon_manager_popup = true;
                self.state.input_mode = crate::tui::state::InputMode::Normal;
                self.state.addon_manager_selected = 1;
                self.state.addon_input_active = false;
                self.state.addon_input_buffer.clear();
                self.load_installed_addons_from_config();
            }

            Action::AddonAddManifest(manifest_url) => {
                let url = manifest_url.trim().to_string();
                if url.is_empty() {
                    return None;
                }

                self.state
                    .set_status("Verifying addon manifest...".to_string(), 200);
                let client = self.service.addon_client.clone();
                let sender = self.action_sender.clone();

                tokio::spawn(async move {
                    match client.fetch_manifest(&url).await {
                        Ok(manifest) => {
                            let installed = InstalledAddon::from_manifest(url.clone(), &manifest);
                            sender
                                .send(Action::SetStatus(format!(
                                    "Installed {} v{}",
                                    installed.name,
                                    installed.version.as_deref().unwrap_or("1.0.0")
                                )))
                                .ok();
                            let mut addons = crate::config::load_addons();
                            addons
                                .retain(|existing| existing.manifest_url != installed.manifest_url);
                            addons.push(installed);
                            crate::config::save_addons(&addons);
                            sender.send(Action::ShowAddonManager).ok();
                        }
                        Err(err) => {
                            sender
                                .send(Action::SetStatus(format!(
                                    "Error: Addon install failed: {err}"
                                )))
                                .ok();
                        }
                    }
                });
            }

            Action::AddonToggleEnabled(index) => {
                if index < self.state.installed_addons.len() {
                    if self.state.installed_addons[index].is_core() {
                        self.state.notify(
                            NotificationKind::Info,
                            "Core Provider",
                            "Cinemeta is the primary metadata provider and is locked enabled.",
                        );
                        return None;
                    }
                    self.state.installed_addons[index].enabled =
                        !self.state.installed_addons[index].enabled;
                    self.save_installed_addons();
                }
            }

            Action::AddonRemove(index) => {
                if index < self.state.installed_addons.len() {
                    if self.state.installed_addons[index].is_core() {
                        self.state.notify(
                            NotificationKind::Warning,
                            "Protected Addon",
                            "Cinemeta is the core metadata provider and cannot be uninstalled.",
                        );
                        return None;
                    }
                    let removed = self.state.installed_addons.remove(index);
                    self.save_installed_addons();
                    self.state.notify(
                        NotificationKind::Info,
                        "Addon Removed",
                        format!("Removed {}", removed.name),
                    );
                    if self.state.addon_manager_selected > self.state.installed_addons.len() {
                        self.state.addon_manager_selected = self.state.installed_addons.len();
                    }
                }
            }

            Action::AddonInputToggle(active) => {
                self.state.addon_input_active = active;
                self.state.addon_input_buffer.clear();
            }

            _ => return None,
        }
        None
    }
}
