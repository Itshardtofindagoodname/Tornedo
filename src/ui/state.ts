/**
 * Human-readable UI state model for downloads. The backend exposes a rich set
 * of lifecycle statuses (and live diagnostics); this module maps them onto a
 * small set of states a user actually cares about, without ever inventing
 * values. Raw backend statuses are only surfaced through diagnostics.
 */
import type { TorrentItem } from "../model/torrent.js";
import { metadataKnown } from "../model/torrent.js";

export type DownloadUiState =
  | { kind: "queued" }
  | { kind: "resolvingMetadata" }
  | { kind: "metadataUnavailable"; retries: number; retryInMs: number | null }
  | { kind: "metadataReady" }
  | { kind: "waitingPeers" }
  | { kind: "downloading" }
  | { kind: "checking" }
  | { kind: "paused" }
  | { kind: "stopped" }
  | { kind: "completed" }
  | { kind: "seeding" }
  | { kind: "failed"; message: string };

/** A state that still has active work happening / is trying to make progress. */
export function isActive(state: DownloadUiState): boolean {
  return (
    state.kind === "downloading" ||
    state.kind === "waitingPeers" ||
    state.kind === "resolvingMetadata" ||
    state.kind === "metadataUnavailable" ||
    state.kind === "metadataReady" ||
    state.kind === "checking"
  );
}

export function downloadState(item: TorrentItem): DownloadUiState {
  const d = item.diagnostics;
  switch (item.status) {
    case "error":
      return { kind: "failed", message: item.error ?? "unknown error" };
    case "queued":
      return { kind: "queued" };
    case "paused":
      return { kind: "paused" };
    case "stopped":
      return { kind: "stopped" };
    case "completed":
      return { kind: "completed" };
    case "seeding":
      return { kind: "seeding" };
    case "checking":
      return { kind: "checking" };
    case "ready":
      return { kind: "metadataReady" };
    case "waiting_metadata":
    case "starting":
      if (d?.metadata === "timeout") {
        return {
          kind: "metadataUnavailable",
          retries: d.metadataRetries ?? 0,
          retryInMs: d.nextRetry ? Math.max(0, d.nextRetry - Date.now()) : null,
        };
      }
      return { kind: "resolvingMetadata" };
    case "downloading":
    case "stalled": {
      // Metadata known but no peers/speed yet: discovery is still retrying.
      const hasActivity = item.peers > 0 || item.downloadSpeed > 0 || item.progress > 0;
      if (metadataKnown(item) && !hasActivity) return { kind: "waitingPeers" };
      return { kind: "downloading" };
    }
    default:
      return { kind: "resolvingMetadata" };
  }
}

/** Short human label for a state, used in list rows and cards. */
export function stateLabel(state: DownloadUiState): string {
  switch (state.kind) {
    case "queued":
      return "queued";
    case "resolvingMetadata":
      return "resolving metadata...";
    case "metadataUnavailable":
      return "metadata unavailable";
    case "metadataReady":
      return "metadata ready";
    case "waitingPeers":
      return "waiting for peers...";
    case "downloading":
      return "downloading";
    case "checking":
      return "checking files...";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "completed":
      return "completed";
    case "seeding":
      return "seeding";
    case "failed":
      return "failed";
  }
}