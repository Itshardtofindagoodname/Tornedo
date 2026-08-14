/**
 * Source registry: the canonical list of source adapters. The search engine and
 * config read from here; individual adapters are never hard-coded elsewhere.
 */
import type { SourceAdapter } from "../model/source.js";
import { bittorrented } from "./bittorrented.js";
import { eztv } from "./eztv.js";
import { limeTorrentsMusic, torrentDownloadsMusic, torrentGalaxyMusic } from "./fallback-music.js";
import { fitgirl } from "./fitgirl.js";
import { nyaa } from "./nyaa.js";
import { piratebayMovies, piratebayMusic, piratebayTv } from "./piratebay.js";
import { subsplease } from "./subsplease.js";
import { x1337Movies, x1337Music, x1337Tv } from "./x1337.js";
import { yts } from "./yts.js";

export const SOURCES: readonly SourceAdapter[] = [
  fitgirl,
  yts,
  piratebayMovies,
  x1337Movies,
  eztv,
  piratebayTv,
  x1337Tv,
  nyaa,
  subsplease,
  bittorrented,
  piratebayMusic,
  x1337Music,
  limeTorrentsMusic,
  torrentGalaxyMusic,
  torrentDownloadsMusic,
];

export function getSource(id: string): SourceAdapter | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function enabledSources(registry: readonly SourceAdapter[], isEnabled: (id: string) => boolean): SourceAdapter[] {
  return registry.filter((s) => isEnabled(s.id));
}

export const DEFAULT_SOURCE_TIMEOUT_MS = 15_000;
