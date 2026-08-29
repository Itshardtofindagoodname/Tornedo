/**
 * LimeTorrents, TorrentGalaxy, and TorrentDownloads adapters. These sites expose
 * magnets directly on their search listing pages, so the fast path avoids
 * detail-page round trips. Each site is instantiated for Movies, TV, and Music.
 */
import { htmlMagnetMusicSource } from "./html-magnet.js";

// ---------------------------------------------------------------------------
// LimeTorrents
// ---------------------------------------------------------------------------

const LIME_HOSTS = ["www.limetorrents.cc", "www.limetorrents.lol"];

export const limeTorrentsMusic = htmlMagnetMusicSource({
  id: "limetorrents-music",
  name: "LimeTorrents",
  homepage: "https://www.limetorrents.lol",
  searchUrls: (query) => {
    const path = `/search/all/${encodeURIComponent(query).replace(/%20/g, "-")}/`;
    return LIME_HOSTS.map((h) => `https://${h}${path}`);
  },
  detailPath: /^\/torrent\/[^/?#]+\.html(?:[?#].*)?$/i,
});

export const limeTorrentsMovies = htmlMagnetMusicSource({
  id: "limetorrents-movies",
  name: "LimeTorrents",
  homepage: "https://www.limetorrents.lol",
  searchUrls: (query) => {
    const path = `/search/movies/${encodeURIComponent(query).replace(/%20/g, "-")}/`;
    return LIME_HOSTS.map((h) => `https://${h}${path}`);
  },
  detailPath: /^\/torrent\/[^/?#]+\.html(?:[?#].*)?$/i,
  categories: ["Movie"],
  groups: ["Movies"],
});

export const limeTorrentsTv = htmlMagnetMusicSource({
  id: "limetorrents-tv",
  name: "LimeTorrents",
  homepage: "https://www.limetorrents.lol",
  searchUrls: (query) => {
    const path = `/search/tv/${encodeURIComponent(query).replace(/%20/g, "-")}/`;
    return LIME_HOSTS.map((h) => `https://${h}${path}`);
  },
  detailPath: /^\/torrent\/[^/?#]+\.html(?:[?#].*)?$/i,
  categories: ["TV"],
  groups: ["TV"],
});

// ---------------------------------------------------------------------------
// TorrentGalaxy
// ---------------------------------------------------------------------------

const TGX_HOSTS = ["torrentgalaxy.to", "tgx.rs", "torrentgalaxy.mx"];

export const torrentGalaxyMusic = htmlMagnetMusicSource({
  id: "torrentgalaxy-music",
  name: "TorrentGalaxy",
  homepage: "https://torrentgalaxy.to",
  searchUrls: (query) =>
    TGX_HOSTS.map((h) => `https://${h}/torrents.php?search=${encodeURIComponent(query)}`),
  detailPath: /^\/torrent\/[^?#]+/i,
});

export const torrentGalaxyMovies = htmlMagnetMusicSource({
  id: "torrentgalaxy-movies",
  name: "TorrentGalaxy",
  homepage: "https://torrentgalaxy.to",
  searchUrls: (query) =>
    TGX_HOSTS.map((h) => `https://${h}/torrents.php?search=${encodeURIComponent(query)}&cat=2`),
  detailPath: /^\/torrent\/[^?#]+/i,
  categories: ["Movie"],
  groups: ["Movies"],
});

export const torrentGalaxyTv = htmlMagnetMusicSource({
  id: "torrentgalaxy-tv",
  name: "TorrentGalaxy",
  homepage: "https://torrentgalaxy.to",
  searchUrls: (query) =>
    TGX_HOSTS.map((h) => `https://${h}/torrents.php?search=${encodeURIComponent(query)}&cat=5`),
  detailPath: /^\/torrent\/[^?#]+/i,
  categories: ["TV"],
  groups: ["TV"],
});

// ---------------------------------------------------------------------------
// TorrentDownloads
// ---------------------------------------------------------------------------

const TD_HOSTS = ["www.torrentdownloads.pro", "www.torrentdownloads.me"];

export const torrentDownloadsMusic = htmlMagnetMusicSource({
  id: "torrentdownloads-music",
  name: "TorrentDownloads",
  homepage: "https://www.torrentdownloads.pro",
  searchUrls: (query) =>
    TD_HOSTS.map((h) => `https://${h}/search/?search=${encodeURIComponent(query)}`),
  detailPath: /^\/torrent\/[^?#]+/i,
});

export const torrentDownloadsMovies = htmlMagnetMusicSource({
  id: "torrentdownloads-movies",
  name: "TorrentDownloads",
  homepage: "https://www.torrentdownloads.pro",
  searchUrls: (query) =>
    TD_HOSTS.map((h) => `https://${h}/search/?search=${encodeURIComponent(query)}&cat=4`),
  detailPath: /^\/torrent\/[^?#]+/i,
  categories: ["Movie"],
  groups: ["Movies"],
});

export const torrentDownloadsTv = htmlMagnetMusicSource({
  id: "torrentdownloads-tv",
  name: "TorrentDownloads",
  homepage: "https://www.torrentdownloads.pro",
  searchUrls: (query) =>
    TD_HOSTS.map((h) => `https://${h}/search/?search=${encodeURIComponent(query)}&cat=8`),
  detailPath: /^\/torrent\/[^?#]+/i,
  categories: ["TV"],
  groups: ["TV"],
});
