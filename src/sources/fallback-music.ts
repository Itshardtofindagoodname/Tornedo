/** Music fallbacks that expose magnets from their public torrent detail pages. */
import { htmlMagnetMusicSource } from "./html-magnet.js";

export const limeTorrentsMusic = htmlMagnetMusicSource({
  id: "limetorrents-music",
  name: "LimeTorrents",
  homepage: "https://www.limetorrents.lol",
  searchUrl: (query) => `https://www.limetorrents.lol/search/all/${encodeURIComponent(query).replace(/%20/g, "-")}/`,
  // Require the detail route (under /torrent/) so nav/footer links like
  // /faq.html or /about.html never become magnet-resolution candidates.
  detailPath: /^\/torrent\/[^/?#]+\.html(?:[?#].*)?$/i,
});

export const torrentGalaxyMusic = htmlMagnetMusicSource({
  id: "torrentgalaxy-music",
  name: "TorrentGalaxy",
  homepage: "https://torrentgalaxy.to",
  searchUrl: (query) => `https://torrentgalaxy.to/torrents.php?search=${encodeURIComponent(query)}`,
  detailPath: /^\/torrent\/[^?#]+/i,
});

export const torrentDownloadsMusic = htmlMagnetMusicSource({
  id: "torrentdownloads-music",
  name: "TorrentDownloads",
  homepage: "https://www.torrentdownloads.pro",
  searchUrl: (query) => `https://www.torrentdownloads.pro/search/?search=${encodeURIComponent(query)}`,
  detailPath: /^\/torrent\/[^?#]+/i,
});
