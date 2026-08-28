pub mod action;
pub mod app;
pub mod commands;
pub use crate::config;
pub mod event;
pub mod overlay;
pub use crate::player;
pub mod state;
pub mod terminal;
pub mod text;
pub mod theme;
pub use crate::updater;

pub fn clear_area(frame: &mut ratatui::Frame, area: ratatui::layout::Rect, _theme: &theme::Theme) {
    frame.render_widget(ratatui::widgets::Clear, area);
}

pub mod screens {
    pub mod details;
    pub mod help;
    pub mod home;
}
