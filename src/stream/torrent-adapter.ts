/**
 * Adapter that maps tornedo search results (Release rows from the federated
 * torrent engine) into Watch-mode catalog items for the "torrent" provider.
 * The infohash is the item identity; everything needed to stream later is
 * carried on `extra` so the stream service never touches torrent internals.
 */
import type { Release } from "../model/search.js";
import type { StreamCatalogItem } from "./models.js";

export function adaptTorrentRelease(release: Release): StreamCatalogItem {
  const entity = release.entity;
  const mediaType = release.category === "TV" || release.category === "Anime" ? "series" : "movie";
  return {
    provider: "torrent",
    id: release.infohash,
    title: (entity?.title ?? "").trim() || release.title,
    mediaType,
    year: entity?.year !== undefined ? String(entity.year) : undefined,
    extra: {
      infohash: release.infohash,
      magnet: release.magnet,
      source: release.sources.join(", "),
      seeders: release.seeders,
      size: release.size,
      files: release.files,
      resolution: entity?.resolution,
      quality: entity?.quality,
    },
  };
}