// Ambient type declarations for the "webtorrent" CJS package, which ships no
// bundled types. Written for Tornedo's own usage; not derived from Torlink.

declare module "webtorrent" {
  import type { EventEmitter } from "node:events";

  interface File {
    name: string;
    path: string;
    length: number;
    offset: number;
    /** 0..1 — fraction of the file's bytes currently on disk. */
    progress: number;
    /** True once every piece of this file is verified. */
    done: boolean;
    select(priority?: number): void;
    deselect(): void;
    stream(opts?: { start?: number; end?: number }): NodeJS.ReadableStream;
  }

  interface Torrent extends EventEmitter {
    infoHash: string;
    magnetURI: string;
    torrentFile: Uint8Array;
    ready: boolean;
    name: string;
    length: number;
    downloaded: number;
    uploaded: number;
    downloadSpeed: number;
    uploadSpeed: number;
    progress: number;
    numPeers: number;
    timeRemaining: number;
    done: boolean;
    paused: boolean;
    path: string;
    files: File[];
    announce: string[];
    pause(): void;
    resume(): void;
    addPeer(peer: string): boolean;
    removePeer(peer: string): void;
    destroy(cb?: (err?: Error) => void): void;
    on(event: "metadata", listener: () => void): this;
    on(event: "ready", listener: () => void): this;
    on(event: "done", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "download", listener: (bytes: number) => void): this;
    on(event: "upload", listener: (bytes: number) => void): this;
    on(event: "warning", listener: (err: Error) => void): this;
    on(event: string | symbol, listener: (...args: never[]) => void): this;
  }

  interface TorrentOptions {
    path?: string;
    announce?: string[];
    destroyStoreOnDestroy?: boolean;
    /** Start with every file deselected so nothing downloads until selected. */
    deselect?: boolean;
  }

  interface WebTorrentOptions {
    maxConns?: number;
    dht?: boolean;
    utp?: boolean;
    tracker?: boolean;
    lsd?: boolean;
    natPmp?: boolean;
    natUpnp?: boolean | "permanent";
    downloadLimit?: number;
    uploadLimit?: number;
  }

  class WebTorrent extends EventEmitter {
    constructor(opts?: WebTorrentOptions);
    readonly torrents: Torrent[];
    readonly downloadSpeed: number;
    readonly uploadSpeed: number;
    readonly torrentPort: number;
    add(torrentId: string | Uint8Array, opts?: TorrentOptions, cb?: (torrent: Torrent) => void): Torrent;
    seed(input: string | string[], opts?: TorrentOptions, cb?: (torrent: Torrent) => void): Torrent;
    get(torrentId: string): Torrent | null;
    remove(torrentId: string, cb?: (err?: Error) => void): void;
    throttleDownload(rate: number): void;
    throttleUpload(rate: number): void;
    destroy(cb?: (err?: Error) => void): void;
  }

  export default WebTorrent;
  export type { Torrent, File, TorrentOptions, WebTorrentOptions };
}