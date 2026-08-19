/**
 * SQLite migrations. Each migration is applied once, in version order, inside a
 * transaction. Never edit a shipped migration — append a new one instead.
 */
import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  up(db: Database.Database): void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial schema",
    up(db) {
      db.exec(`
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE torrents (
          id TEXT PRIMARY KEY,
          infohash TEXT NOT NULL,
          magnet TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT,
          source_id TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          destination TEXT NOT NULL,
          status TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          downloaded INTEGER NOT NULL DEFAULT 0,
          uploaded INTEGER NOT NULL DEFAULT 0,
          size INTEGER NOT NULL DEFAULT 0,
          download_speed INTEGER NOT NULL DEFAULT 0,
          upload_speed INTEGER NOT NULL DEFAULT 0,
          peers INTEGER NOT NULL DEFAULT 0,
          seeds INTEGER NOT NULL DEFAULT 0,
          time_remaining REAL NOT NULL DEFAULT -1,
          priority INTEGER NOT NULL DEFAULT 0,
          seed_enabled INTEGER NOT NULL DEFAULT 1,
          files INTEGER,
          queued_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          last_updated INTEGER NOT NULL,
          error TEXT
        );

        CREATE TABLE torrent_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          torrent_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          length INTEGER NOT NULL,
          FOREIGN KEY (torrent_id) REFERENCES torrents(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_torrent_files_torrent ON torrent_files(torrent_id);

        CREATE TABLE torrent_cache (
          id TEXT PRIMARY KEY,
          data BLOB NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE watch_files (
          path TEXT PRIMARY KEY,
          mtime INTEGER NOT NULL,
          size INTEGER NOT NULL,
          hash TEXT NOT NULL,
          added_at INTEGER NOT NULL
        );

        CREATE INDEX idx_torrents_status ON torrents(status);
        CREATE INDEX idx_torrents_queued_at ON torrents(queued_at);
      `);
    },
  },
  {
    version: 2,
    name: "torrents.searchable name index",
    up(db) {
      db.exec(`CREATE INDEX idx_torrents_name ON torrents(name);`);
    },
  },
  {
    version: 3,
    name: "media (yt-dlp) download items",
    up(db) {
      db.exec(
        `ALTER TABLE torrents ADD COLUMN kind TEXT NOT NULL DEFAULT 'torrent';
         ALTER TABLE torrents ADD COLUMN media TEXT;`,
      );
    },
  },
  {
    version: 4,
    name: "drop media (yt-dlp) download columns",
    up(db) {
      // Media/stream downloads were removed; delete any rows created by v3 and
      // drop the now-unused columns.
      db.exec(
        `DELETE FROM torrents WHERE kind = 'media';
         ALTER TABLE torrents DROP COLUMN media;
         ALTER TABLE torrents DROP COLUMN kind;`,
      );
    },
  },
  {
    version: 5,
    name: "separate source-reported and torrent-metadata sizes",
    up(db) {
      // Distinguish the size reported by the search source (known at add time)
      // from the size reported by the torrent's own metadata (known only after
      // metadata resolution). NULL means "not known yet" — never a fake zero.
      db.exec(
        `ALTER TABLE torrents ADD COLUMN source_size INTEGER;
         ALTER TABLE torrents ADD COLUMN torrent_size INTEGER;`,
      );
    },
  },
  {
    version: 6,
    name: "per-torrent file selection",
    up(db) {
      // JSON array of relative file paths; NULL/empty means "download everything".
      db.exec(`ALTER TABLE torrents ADD COLUMN selected_files TEXT;`);
    },
  },
];

export function latestSchemaVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
}