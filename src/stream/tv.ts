/**
 * Live-TV / M3U playlist support. Parses M3U8/M3U text from a URL, remote
 * resource or local file path, exposing channels with group/logo metadata.
 */
import { readFile } from "node:fs/promises";
import { StreamCatalogItem, TvChannel } from "./models.js";

/** A configured live-TV playlist (a URL or a local file path). */
export interface TvPlaylist {
  name: string;
  url: string;
}

/** How long a fetched playlist stays valid before it is re-read. */
const PLAYLIST_TTL_MS = 10 * 60 * 1000;

const playlistCache = new Map<string, { at: number; channels: TvChannel[] }>();

export async function loadM3u(source: string, signal?: AbortSignal): Promise<TvChannel[]> {
  let text: string;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source, {
      headers: { "user-agent": "tornedo/5.0", accept: "*/*" },
      signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${source} -> HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = await readFile(source, "utf8");
  }
  return parseM3u(text);
}

export function parseM3u(input: string): TvChannel[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const channels: TvChannel[] = [];
  let pending: {
    name: string;
    logo?: string;
    group?: string;
    tvgId?: string;
    groupTitle?: string;
  } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#EXTINF")) {
      const logo = /tvg-logo="([^"]*)"/i.exec(trimmed)?.[1];
      const group = /group-title="([^"]*)"/i.exec(trimmed)?.[1];
      const tvgId = /tvg-id="([^"]*)"/i.exec(trimmed)?.[1];
      const name = trimmed.split(",").slice(1).join(",").trim();
      pending = { name, logo, group, tvgId };
    } else if (trimmed.startsWith("#EXTGRP:")) {
      if (pending !== null) pending.group = trimmed.slice("#EXTGRP:".length).trim();
    } else if (trimmed.startsWith("#")) {
      continue;
    } else if (pending !== null) {
      channels.push({
        id: channelId(pending.name),
        name: pending.name || trimmed,
        logo: pending.logo,
        group: pending.group,
        streamUrl: trimmed,
        tvgId: pending.tvgId,
      });
      pending = null;
    }
  }
  return channels;
}

function channelId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : name;
}

export function groupChannels(channels: TvChannel[]): Map<string, TvChannel[]> {
  const groups = new Map<string, TvChannel[]>();
  for (const ch of channels) {
    const group = ch.group ?? "Ungrouped";
    const list = groups.get(group) ?? [];
    list.push(ch);
    groups.set(group, list);
  }
  return groups;
}

/**
 * Load a playlist's channels with a short in-memory TTL so repeated searches
 * don't re-fetch the whole m3u. Errors propagate to the caller (the search
 * layer collects them per playlist).
 */
export async function loadPlaylistChannels(playlist: TvPlaylist, signal?: AbortSignal): Promise<TvChannel[]> {
  const cached = playlistCache.get(playlist.url);
  if (cached !== undefined && Date.now() - cached.at < PLAYLIST_TTL_MS) return cached.channels;
  const channels = await loadM3u(playlist.url, signal);
  playlistCache.set(playlist.url, { at: Date.now(), channels });
  return channels;
}

/** Rank channels by how well they match the query (empty query = all). */
export function searchChannels(channels: TvChannel[], query: string, limit = 80): TvChannel[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return channels.slice(0, limit);
  const ranked: { ch: TvChannel; score: number }[] = [];
  for (const ch of channels) {
    const name = ch.name.toLowerCase();
    const group = (ch.group ?? "").toLowerCase();
    let score = name.includes(q) ? 1 : 0;
    if (name.startsWith(q)) score += 2;
    if (group.includes(q)) score += 1;
    if (ch.tvgId !== undefined && ch.tvgId.toLowerCase().includes(q)) score += 1;
    if (score === 0) continue;
    ranked.push({ ch, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.ch.name.localeCompare(b.ch.name));
  return ranked.map((r) => r.ch).slice(0, limit);
}

/** Adapt a playlist channel into a normal catalog row the UI can open. */
export function channelToCatalog(channel: TvChannel, playlist: TvPlaylist): StreamCatalogItem {
  return {
    provider: "tv",
    id: `${playlist.name}://${channel.id}`,
    title: channel.name,
    mediaType: "tv",
    posterUrl: channel.logo,
    extra: {
      playlist: playlist.name,
      group: channel.group,
      streamUrl: channel.streamUrl,
      logo: channel.logo,
    },
  };
}