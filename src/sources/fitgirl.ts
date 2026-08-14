/**
 * FitGirl Repacks (fitgirl-repacks.site) WordPress RSS adapter for games.
 * WordPress RSS carries no swarm data, so seeders are unknown (reportsHealth
 * false) — results must never be filtered as "dead" on that basis.
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchWordpressRss } from "./rss.js";

const HOME = "https://fitgirl-repacks.site";
const CATEGORY: MediaCategory = "Game";

export const fitgirl: SourceAdapter = {
  id: "fitgirl",
  name: "FitGirl",
  groups: ["Games"],
  categories: ["Game"],
  homepage: HOME,
  timeoutMs: 20_000,
  concurrency: 1,
  reportsHealth: false,
  search: async (query: string, ctx: SearchContext): Promise<SearchResult[]> => {
    const results = await fetchWordpressRss(HOME, "fitgirl", query, ctx);
    for (const r of results) r.category = CATEGORY;
    return results;
  },
};