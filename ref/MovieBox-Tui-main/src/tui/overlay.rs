use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, List, ListItem, ListState, Paragraph, Scrollbar,
        ScrollbarOrientation, ScrollbarState,
    },
};

use crate::tui::theme::Theme;

const MAX_PICKER_ROWS: usize = 8;

pub use crate::models::{Notification, NotificationKind};

pub struct PickerSpec<'a> {
    pub title: &'a str,
    pub confirm_label: &'a str,
    pub minimum_width: u16,
}

pub fn picker(
    frame: &mut Frame,
    area: Rect,
    items: &[String],
    state: &mut ListState,
    spec: PickerSpec<'_>,
    theme: &Theme,
    basic_terminal: bool,
) {
    let selected = state
        .selected()
        .unwrap_or(0)
        .min(items.len().saturating_sub(1));
    let visible_rows = items.len().clamp(1, MAX_PICKER_ROWS);
    let footer_str = format!("[↑↓] Move  [Enter] {}  [Esc] Back", spec.confirm_label);
    let footer_width = crate::tui::text::width(&footer_str);
    let content_width = items
        .iter()
        .map(|item| crate::tui::text::width(item))
        .max()
        .unwrap_or(0)
        .max(footer_width)
        .saturating_add(4);
    let popup = centered(
        area,
        content_width as u16,
        visible_rows as u16 + 4,
        spec.minimum_width,
        64,
    );
    clear_modal_area(frame, area, popup, theme);

    let title = format!(
        " {} · {}/{} ",
        spec.title,
        selected.saturating_add(1),
        items.len().max(1)
    );
    let block = Block::default()
        .title(title)
        .title_style(theme.title)
        .borders(Borders::ALL)
        .border_type(border_type(basic_terminal))
        .border_style(theme.lavender);
    let inner = block.inner(popup);
    frame.render_widget(block, popup);

    let sections = Layout::vertical([Constraint::Min(1), Constraint::Length(2)]).split(inner);
    let max_item_w = sections[0]
        .width
        .saturating_sub(if items.len() > visible_rows { 3 } else { 1 })
        as usize;
    let list_items = items
        .iter()
        .map(|item| {
            let truncated = crate::tui::text::truncate_width(item, max_item_w);
            ListItem::new(truncated).style(theme.text)
        })
        .collect::<Vec<_>>();
    let list = List::new(list_items)
        .highlight_style(selection_style(theme, basic_terminal))
        .highlight_symbol(if basic_terminal { "> " } else { "▌ " });
    frame.render_stateful_widget(list, sections[0], state);

    if items.len() > visible_rows {
        let mut scrollbar_state = ScrollbarState::new(items.len())
            .viewport_content_length(visible_rows)
            .position(selected);
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .thumb_style(theme.lavender)
            .track_style(theme.surface1)
            .begin_symbol(Some("▲"))
            .end_symbol(Some("▼"));
        frame.render_stateful_widget(scrollbar, sections[0], &mut scrollbar_state);
    }

    let confirm_label = if sections[1].width < 40 && spec.confirm_label == "Download" {
        "Save"
    } else {
        spec.confirm_label
    };
    let footer = Line::from(vec![
        key_hint("↑↓", "Move", theme),
        Span::raw("  "),
        key_hint("Enter", confirm_label, theme),
        Span::raw("  "),
        key_hint("Esc", "Back", theme),
    ]);
    frame.render_widget(
        Paragraph::new(footer).alignment(Alignment::Center).block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(theme.muted),
        ),
        sections[1],
    );
}

pub fn confirmation(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    summary: &[Line<'_>],
    confirm_selected: bool,
    theme: &Theme,
    basic_terminal: bool,
) {
    let content_width = summary.iter().map(Line::width).max().unwrap_or(0).max(36);
    let popup = centered(
        area,
        content_width.saturating_add(4) as u16,
        summary.len() as u16 + 4,
        36,
        64,
    );
    clear_modal_area(frame, area, popup, theme);

    let block = Block::default()
        .title(format!(" {title} "))
        .title_style(theme.title)
        .borders(Borders::ALL)
        .border_type(border_type(basic_terminal))
        .border_style(theme.lavender);
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    let sections = Layout::vertical([
        Constraint::Length(summary.len() as u16),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .split(inner);
    frame.render_widget(
        Paragraph::new(summary.to_vec()).alignment(Alignment::Center),
        sections[0],
    );

    let selected_style = selection_style(theme, basic_terminal);
    let actions = Line::from(vec![
        Span::styled(
            " Download ",
            if confirm_selected {
                selected_style
            } else {
                theme.text_dim
            },
        ),
        Span::raw("    "),
        Span::styled(
            " Cancel ",
            if confirm_selected {
                theme.text_dim
            } else {
                selected_style
            },
        ),
    ]);
    frame.render_widget(
        Paragraph::new(actions).alignment(Alignment::Center),
        sections[1],
    );
    let footer = if sections[2].width < 44 {
        Line::from(vec![
            key_hint("←→", "Choose", theme),
            Span::raw(" "),
            key_hint("Enter", "OK", theme),
            Span::raw(" "),
            key_hint("Esc", "Back", theme),
        ])
    } else {
        Line::from(vec![
            key_hint("←→", "Choose", theme),
            Span::raw("  "),
            key_hint("Enter", "Confirm", theme),
            Span::raw("  "),
            key_hint("Esc", "Back", theme),
        ])
    };
    frame.render_widget(
        Paragraph::new(footer).alignment(Alignment::Center),
        sections[2],
    );
}

pub fn notifications(
    frame: &mut Frame,
    area: Rect,
    notifications: &std::collections::VecDeque<Notification>,
    theme: &Theme,
    basic_terminal: bool,
) {
    let mut y = area.bottom().saturating_sub(2);

    for notification in notifications.iter().rev().take(3) {
        let (badge, badge_style) = notification_style(notification.kind, theme, basic_terminal);
        let has_message =
            !notification.message.is_empty() && notification.message != notification.title;

        let max_card_width = (area.width.saturating_sub(4) as usize).min(72);
        let title_w = crate::tui::text::width(&notification.title).saturating_add(6);
        let badge_w = badge.len().saturating_add(6);
        let raw_msg_w = if has_message {
            crate::tui::text::width(&notification.message).saturating_add(6)
        } else {
            0
        };

        let target_card_width = title_w
            .max(badge_w)
            .max(raw_msg_w)
            .clamp(36, max_card_width) as u16;

        let inner_width = (target_card_width.saturating_sub(4) as usize).max(1);

        let msg_lines: Vec<String> = if has_message {
            crate::tui::text::wrap_text(&notification.message, inner_width)
                .into_iter()
                .take(4)
                .collect()
        } else {
            Vec::new()
        };

        let height = 2 + 1 + msg_lines.len() as u16;

        if target_card_width < 10 || y < area.y.saturating_add(height) {
            break;
        }

        y = y.saturating_sub(height);

        let toast_area = Rect::new(
            area.right()
                .saturating_sub(target_card_width)
                .saturating_sub(2),
            y,
            target_card_width,
            height,
        );

        crate::tui::clear_area(frame, toast_area, theme);

        let mut lines = Vec::new();
        lines.push(Line::from(vec![Span::styled(
            crate::tui::text::truncate_width(&notification.title, inner_width),
            theme.text.add_modifier(Modifier::BOLD),
        )]));

        for line in &msg_lines {
            lines.push(Line::from(vec![Span::styled(
                crate::tui::text::truncate_width(line, inner_width),
                theme.subtext1,
            )]));
        }

        let block = Block::default()
            .title(Line::from(vec![Span::styled(
                format!(" {badge} "),
                badge_style.add_modifier(Modifier::BOLD),
            )]))
            .borders(Borders::ALL)
            .border_type(border_type(basic_terminal))
            .border_style(badge_style)
            .padding(ratatui::widgets::Padding::horizontal(1));

        frame.render_widget(Paragraph::new(lines).block(block), toast_area);

        y = y.saturating_sub(1);
    }
}

pub fn centered(
    area: Rect,
    desired_width: u16,
    desired_height: u16,
    minimum_width: u16,
    maximum_width: u16,
) -> Rect {
    let available_width = area.width.saturating_sub(2).max(1);
    let available_height = area.height.saturating_sub(2).max(1);
    let width = desired_width
        .max(minimum_width.min(available_width))
        .min(maximum_width)
        .min(available_width);
    let height = desired_height.min(available_height).max(1);
    Rect::new(
        area.x + area.width.saturating_sub(width) / 2,
        area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    )
}

pub fn clear_modal_area(frame: &mut Frame, bounds: Rect, popup: Rect, theme: &Theme) {
    const HORIZONTAL_HALO: u16 = 3;
    const VERTICAL_HALO: u16 = 1;

    let x = popup.x.saturating_sub(HORIZONTAL_HALO).max(bounds.x);
    let y = popup.y.saturating_sub(VERTICAL_HALO).max(bounds.y);
    let right = popup
        .right()
        .saturating_add(HORIZONTAL_HALO)
        .min(bounds.right());
    let bottom = popup
        .bottom()
        .saturating_add(VERTICAL_HALO)
        .min(bounds.bottom());
    crate::tui::clear_area(
        frame,
        Rect::new(x, y, right.saturating_sub(x), bottom.saturating_sub(y)),
        theme,
    );
}

pub fn border_type(basic_terminal: bool) -> BorderType {
    if basic_terminal {
        BorderType::Plain
    } else {
        BorderType::Rounded
    }
}

pub(crate) fn key_hint(key: &str, action: &str, theme: &Theme) -> Span<'static> {
    Span::styled(format!("[{key}] {action}"), theme.text_dim)
}

pub(crate) fn selection_style(theme: &Theme, basic_terminal: bool) -> Style {
    let style = theme.text.add_modifier(Modifier::BOLD);
    if basic_terminal {
        style.add_modifier(Modifier::UNDERLINED)
    } else {
        style.bg(theme.surface0.fg.unwrap_or(theme.base))
    }
}

fn notification_style(
    kind: NotificationKind,
    theme: &Theme,
    _basic_terminal: bool,
) -> (&'static str, Style) {
    match kind {
        NotificationKind::Info => ("INFO", theme.sapphire),
        NotificationKind::Success => ("SUCCESS", theme.success),
        NotificationKind::Warning => ("WARNING", theme.rating),
        NotificationKind::Error => ("ERROR", theme.error),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateModalLayout {
    pub popup_area: Rect,
    pub display_count: usize,
    pub has_more: bool,
    pub button_row_y: u16,
    pub update_btn_end_x: u16,
    pub open_btn_end_x: u16,
    pub open_button_midpoint_x: u16,
}

pub fn update_modal_layout(area: Rect, notes: &str) -> UpdateModalLayout {
    let note_lines_count = notes
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .count();

    let min_w: u16 = 46;
    let max_w: u16 = 72;
    let desired_w = max_w.min(area.width.saturating_sub(4)).max(min_w);

    let header_rows: u16 = 5;
    let footer_rows: u16 = 3;
    let available_height = area.height.saturating_sub(4);
    let available_note_rows =
        (available_height.saturating_sub(header_rows + footer_rows) as usize).clamp(2, 10);

    let display_count = note_lines_count.min(available_note_rows);
    let has_more = note_lines_count > display_count;
    let total_rows =
        header_rows + (display_count as u16) + (if has_more { 1 } else { 0 }) + footer_rows;
    let desired_h = total_rows.clamp(10, available_height.max(10));

    let popup_area = centered(area, desired_w, desired_h, min_w, max_w);
    let button_row_y = popup_area.y + popup_area.height.saturating_sub(2);
    let update_btn_end_x = popup_area.x + popup_area.width / 3;
    let open_btn_end_x = popup_area.x + (popup_area.width * 2) / 3;
    let open_button_midpoint_x = popup_area.x + popup_area.width / 2;

    UpdateModalLayout {
        popup_area,
        display_count,
        has_more,
        button_row_y,
        update_btn_end_x,
        open_btn_end_x,
        open_button_midpoint_x,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_modal_mouse_hitbox_matches_rendered_geometry() {
        let area = Rect::new(0, 0, 80, 24);
        let notes = "Line 1\nLine 2\nLine 3\nLine 4";
        let layout = update_modal_layout(area, notes);

        assert_eq!(layout.popup_area.width, 72);
        assert_eq!(layout.display_count, 4);
        assert!(!layout.has_more);
        assert_eq!(layout.popup_area.height, 12);
        assert_eq!(layout.popup_area.x, (80 - 72) / 2);
        assert_eq!(layout.popup_area.y, (24 - 12) / 2);
        assert_eq!(layout.button_row_y, layout.popup_area.y + 10);
        assert_eq!(layout.open_button_midpoint_x, layout.popup_area.x + 36);
    }

    #[test]
    fn test_update_modal_open_release_click() {
        let area = Rect::new(0, 0, 80, 24);
        let notes = "### Highlights\n- Feature A\n- Feature B";
        let layout = update_modal_layout(area, notes);

        let click_x = layout.popup_area.x + 5;
        let click_y = layout.button_row_y;

        assert!(
            layout
                .popup_area
                .contains(ratatui::layout::Position::new(click_x, click_y))
        );
        assert_eq!(click_y, layout.button_row_y);
        assert!(click_x < layout.open_button_midpoint_x);
    }

    #[test]
    fn test_update_modal_dismiss_click() {
        let area = Rect::new(0, 0, 80, 24);
        let notes = "Feature A";
        let layout = update_modal_layout(area, notes);

        let dismiss_x = layout.open_button_midpoint_x + 5;
        let dismiss_y = layout.button_row_y;

        assert!(
            layout
                .popup_area
                .contains(ratatui::layout::Position::new(dismiss_x, dismiss_y))
        );
        assert_eq!(dismiss_y, layout.button_row_y);
        assert!(dismiss_x >= layout.open_button_midpoint_x);

        let outside_x = layout.popup_area.x.saturating_sub(2);
        let outside_y = layout.popup_area.y.saturating_sub(2);
        assert!(
            !layout
                .popup_area
                .contains(ratatui::layout::Position::new(outside_x, outside_y))
        );
    }

    #[test]
    fn test_update_modal_geometry_bounds_various_screens() {
        let notes = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\nLine 11";

        let compact = update_modal_layout(Rect::new(0, 0, 40, 15), notes);
        assert!(compact.popup_area.width <= 38);
        assert!(compact.popup_area.height <= 13);
        assert!(compact.has_more);

        let large = update_modal_layout(Rect::new(0, 0, 160, 50), notes);
        assert_eq!(large.popup_area.width, 72);
        assert_eq!(large.display_count, 10);
        assert!(large.has_more);
    }
}
