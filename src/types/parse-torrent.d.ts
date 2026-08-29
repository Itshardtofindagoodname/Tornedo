// Ambient type declarations for the "parse-torrent" CJS package, which ships no
// bundled types. Only the surface Tornedo touches is declared.

declare module "parse-torrent" {
  interface ParsedTorrentFile {
    name?: string;
    path?: string;
    length?: number;
    offset?: number;
  }

  interface ParsedTorrent {
    infoHash: string;
    infoHashBuffer?: Uint8Array;
    name?: string;
    announce?: string[];
    length?: number;
    private?: boolean;
    files?: ParsedTorrentFile[];
    torrentFile?: Uint8Array;
  }

  const parseTorrent: {
    (torrentId: string | Uint8Array): Promise<ParsedTorrent | null>;
    remote(torrentId: string, cb: (err?: Error, parsed?: ParsedTorrent) => void): void;
    toMagnetURI(parsed: ParsedTorrent): string;
  };

  export default parseTorrent;
  export type { ParsedTorrent, ParsedTorrentFile };
}