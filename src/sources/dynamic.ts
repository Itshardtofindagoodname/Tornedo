/**
 * Dynamic (user-configured) source adapters.
 *
 * The static registry (SOURCES) holds built-in adapters; this module turns the
 * user's configuration — Torznab endpoints and the Internet Archive — into the
 * same SourceAdapter contract. The federated engine and UI never distinguish
 * built-in from dynamic sources.
 */
import type { TornedoConfig } from "../config/config.js";
import type { SourceAdapter } from "../model/source.js";
import { internetArchiveSource } from "./internet-archive.js";
import { torznabSource } from "./torznab.js";

export function dynamicSources(config: TornedoConfig): SourceAdapter[] {
  const out: SourceAdapter[] = [];
  config.torznabProviders.forEach((provider, index) => {
    if (!provider.enabled) return;
    out.push(torznabSource(provider, index));
  });
  if (config.internetArchive.enabled) {
    out.push(internetArchiveSource(config.internetArchive));
  }
  return out;
}