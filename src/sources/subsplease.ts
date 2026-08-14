/**
 * SubsPlease (subsplease.org) anime API adapter.
 * API: GET /api/?f=search&s=<query>&tz=UTC | ?f=latest
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchJson } from "./net.js";
import { parseMagnet } from "../torrent/parse.js";

const API = "https://subsplease.org/api/";
const RES_PREFERENCE = ["1080", "720", "480"];
const CATEGORY: MediaCategory = "Anime";

interface SpDownload {
  res?: string;
  magnet?: string;
}

interface SpEntry {
  show?: string;
  episode?: string;
  release_date?: string;
  downloads?: SpDownload[];
}

function pickBest(downloads: SpDownload[]): SpDownload | undefined {
  for (const res of RES_PREFERENCE) {
    const d = downloads.find((x) => x.res === res && x.magnet);
    if (d) return d;
  }
  return downloads.find((x) => x.magnet);
}

export async function search(query: string, ctx: SearchContext): Promise<SearchResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({ tz: "UTC" });
  if (q) {
    params.set("f", "search");
    params.set("s", q);
  } else {
    params.set("f", "latest");
  }

  const json = await fetchJson<Record<string, SpEntry>>(`${API}?${params.toString()}`, {
    signal: ctx.signal,
    timeoutMs: ctx.timeoutMs,
    retries: 1,
  });
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];

  const out: SearchResult[] = [];
  for (const entry of Object.values(json)) {
    const dl = pickBest(entry.downloads ?? []);
    if (!dl?.magnet) continue;
    const parsed = parseMagnet(dl.magnet);
    if (!parsed) continue;
    const show = entry.show ?? "Unknown";
    const ep = entry.episode ? ` - ${entry.episode}` : "";
    const title = `${show}${ep} [${dl.res ?? "?"}p]`;
    const xl = dl.magnet.match(/[?&]xl=(\d+)/);
    out.push({
      infohash: parsed.infoHash,
      title,
      size: xl ? Number(xl[1]) : undefined,
      sourceId: "subsplease",
      category: CATEGORY,
      magnet: parsed.magnet,
      added: entry.release_date ? Math.floor(new Date(entry.release_date).getTime() / 1000) : undefined,
    });
  }
  return out;
}

export const subsplease: SourceAdapter = {
  id: "subsplease",
  name: "SubsPlease",
  groups: ["Anime"],
  categories: ["Anime"],
  homepage: "https://subsplease.org",
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: false,
  search,
};