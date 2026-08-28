use crate::tui::action::Action;
use crossterm::event::{Event as CrosstermEvent, KeyEventKind};
use std::time::Duration;
use tokio::sync::mpsc;

pub struct EventHandler {
    receiver: mpsc::Receiver<Action>,
}

impl EventHandler {
    pub fn new(tick_rate: Duration) -> Self {
        let (sender, receiver) = mpsc::channel(128);
        let event_sender = sender.clone();

        tokio::spawn({
            let signal_sender = sender.clone();
            async move {
                while tokio::signal::ctrl_c().await.is_ok() {
                    if signal_sender.send(Action::Quit).await.is_err() {
                        break;
                    }
                }
            }
        });

        tokio::spawn(async move {
            let mut tick_interval = tokio::time::interval(tick_rate);
            let mut reader = crossterm::event::EventStream::new();
            use futures::StreamExt;

            loop {
                tokio::select! {
                    _ = tick_interval.tick() => {
                        let _ = event_sender.try_send(Action::Tick);
                    }
                    Some(event) = reader.next() => {
                        match event {
                            Ok(CrosstermEvent::Key(key)) => {
                                if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
                                    let _ = event_sender.send(Action::Key(key)).await;
                                }
                            }
                            Ok(CrosstermEvent::Mouse(mouse)) => {
                                match mouse.kind {
                                    crossterm::event::MouseEventKind::ScrollUp => {
                                        let _ = event_sender.send(Action::Key(crossterm::event::KeyEvent::new(crossterm::event::KeyCode::Up, crossterm::event::KeyModifiers::empty()))).await;
                                    }
                                    crossterm::event::MouseEventKind::ScrollDown => {
                                        let _ = event_sender.send(Action::Key(crossterm::event::KeyEvent::new(crossterm::event::KeyCode::Down, crossterm::event::KeyModifiers::empty()))).await;
                                    }
                                    crossterm::event::MouseEventKind::Down(crossterm::event::MouseButton::Left) => {
                                        let _ = event_sender.send(Action::MouseClick(mouse.column, mouse.row)).await;
                                    }
                                    _ => {}
                                }
                            }
                            Ok(CrosstermEvent::FocusGained) | Ok(CrosstermEvent::FocusLost) => {
                                let _ = event_sender.send(Action::FocusChange).await;
                            }
                            Ok(CrosstermEvent::Resize(w, h)) => {
                                let _ = event_sender.send(Action::Resize(w, h)).await;
                            }
                            Err(error) => {
                                if error.kind() == std::io::ErrorKind::Interrupted {
                                    continue;
                                }
                                log::warn!("terminal input error: {error}");
                                tokio::time::sleep(Duration::from_millis(50)).await;
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        Self { receiver }
    }

    pub async fn next(&mut self) -> Option<Action> {
        self.receiver.recv().await
    }

    pub fn try_recv(&mut self) -> Result<Action, mpsc::error::TryRecvError> {
        self.receiver.try_recv()
    }
}
