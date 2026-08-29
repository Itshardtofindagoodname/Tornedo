/**
 * Watch history: what has been watched and where playback stopped, so
 * "Continue watching" can resume at the right position. Progress is recorded
 * after a player exits (mpv's tracker script writes position/duration to the
 * tracker state file, which we reconcile on exit).
 */
import { readFile, rm } from "node:fs/promises";
import { JsonStore } from "./store.js";
import { StreamDetails, StreamProviderId } from "./models.js";

export interface HistoryItem {
  provider: StreamProviderId;
  id: string;
  title: string;
  year?: string;
  posterUrl?: string;
  mediaType: "movie" | "series" | "tv";
  season?: number;
  episode?: number;
  episodeTitle?: string;
  /** Seconds into the file at last exit; 0 marks a fresh/complete watch. */
  time: number;
  duration: number;
  completed: boolean;
  lastWatched: string; // ISO
  streamLabel?: string;
}

function historyKey(item: Pick<HistoryItem, "id" | "season" | "episode">): string {
  return `${item.season ?? 0}:${item.episode ?? 0}:${item.id}`;
}

export class HistoryManager {
  private readonly store: JsonStore<HistoryItem[]>;
  private cache: HistoryItem[] | null = null;

  constructor(file: string) {
    this.store = new JsonStore<HistoryItem[]>(file);
  }

  async list(): Promise<HistoryItem[]> {
    if (this.cache !== null) return [...this.cache];
    const rows = (await this.store.read()) ?? [];
    this.cache = rows.sort((a, b) => b.lastWatched.localeCompare(a.lastWatched));
    return [...this.cache];
  }

  async recent(limit = 8): Promise<HistoryItem[]> {
    await this.list();
    return this.cache!.slice(0, limit);
  }

  async ongoing(): Promise<HistoryItem[]> {
    await this.list();
    return this.cache!.filter((h) => !h.completed && h.time > 30).slice(0, 6);
  }

  async find(ref: Pick<HistoryItem, "id" | "season" | "episode">): Promise<HistoryItem | undefined> {
    await this.list();
    return this.cache!.find((h) => historyKey(h) === historyKey(ref));
  }

  async record(item: Omit<HistoryItem, "completed" | "lastWatched"> & Partial<Pick<HistoryItem, "time" | "duration" | "completed">>): Promise<HistoryItem> {
    await this.list();
    const key = historyKey({ id: item.id, season: item.season, episode: item.episode });
    const existing = this.cache!.find((h) => historyKey(h) === key);
    const time = item.time ?? 0;
    const duration = item.duration ?? 0;
    const completed = item.completed ?? (duration > 0 && time > duration - 120);
    const row: HistoryItem = {
      ...item,
      time,
      duration,
      completed,
      lastWatched: new Date().toISOString(),
    };
    if (existing !== undefined) {
      const idx = this.cache!.indexOf(existing);
      this.cache![idx] = row;
    } else {
      this.cache!.unshift(row);
    }
    this.cache!.sort((a, b) => b.lastWatched.localeCompare(a.lastWatched));
    await this.store.write(this.cache!);
    return row;
  }

  async updateProgress(
    ref: Pick<HistoryItem, "id" | "season" | "episode">,
    time: number,
    duration: number,
  ): Promise<HistoryItem | null> {
    await this.list();
    const existing = this.cache!.find((h) => historyKey(h) === historyKey(ref));
    if (existing === undefined) return null;
    existing.time = Math.max(0, Math.floor(time));
    existing.duration = duration;
    existing.completed = duration > 0 && existing.time > duration - 120;
    existing.lastWatched = new Date().toISOString();
    this.cache!.sort((a, b) => b.lastWatched.localeCompare(a.lastWatched));
    await this.store.write(this.cache!);
    return { ...existing };
  }

  async markCompleted(ref: Pick<HistoryItem, "id" | "season" | "episode">): Promise<HistoryItem | null> {
    await this.list();
    const existing = this.cache!.find((h) => historyKey(h) === historyKey(ref));
    if (existing === undefined) return null;
    existing.completed = true;
    existing.time = existing.duration;
    existing.lastWatched = new Date().toISOString();
    await this.store.write(this.cache!);
    return { ...existing };
  }

  async remove(ref: Pick<HistoryItem, "id" | "season" | "episode">): Promise<void> {
    await this.list();
    const key = historyKey(ref);
    this.cache = this.cache!.filter((h) => historyKey(h) !== key);
    await this.store.write(this.cache!);
  }

  fromDetails(details: StreamDetails, opts?: { season?: number; episode?: number }): HistoryItem {
    return {
      provider: details.provider,
      id: details.id,
      title: details.title,
      year: details.year,
      posterUrl: details.posterUrl,
      mediaType: details.mediaType === "series" ? "series" : "movie",
      season: opts?.season,
      episode: opts?.episode,
      time: 0,
      duration: 0,
      completed: false,
      lastWatched: new Date().toISOString(),
    };
  }
}

/** Reconcile an mpv tracker JSON payload written on player exit. */
export async function readTrackerState(file: string): Promise<{ path: string; time: number; duration: number } | null> {
  try {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as { path: string; time: number; duration: number }[];
    const first = parsed[0];
    await rm(file, { force: true });
    if (first === undefined) return null;
    return { path: first.path, time: first.time, duration: first.duration };
  } catch {
    return null;
  }
}