/**
 * Watch-mode favorites. Stores per-provider favorite rows (movies, series or a
 * specific series episode) in a JSON file under the state dir, mirroring the
 * MovieBox-Tui favorites file format.
 */
import { StreamCatalogItem, StreamMediaType, StreamProviderId } from "./models.js";
import { JsonStore } from "./store.js";

export interface Favorite {
  provider: StreamProviderId;
  id: string;
  title: string;
  mediaType: StreamMediaType;
  year?: string;
  posterUrl?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  /** Number of release streams, if known while browsing details. */
  streamCount?: number;
  addedOn: string;
}

function favoriteKey(f: Pick<Favorite, "id" | "season" | "episode">): string {
  return `${f.season ?? 0}:${f.episode ?? 0}:${f.id}`;
}

export class FavoritesManager {
  private readonly store: JsonStore<Favorite[]>;
  private cache: Favorite[] | null = null;

  constructor(file: string) {
    this.store = new JsonStore<Favorite[]>(file);
  }

  async list(): Promise<Favorite[]> {
    if (this.cache !== null) return [...this.cache];
    const rows = (await this.store.read()) ?? [];
    this.cache = rows.sort((a, b) => b.addedOn.localeCompare(a.addedOn));
    return [...this.cache];
  }

  async is(favorite: Pick<Favorite, "id" | "season" | "episode">): Promise<boolean> {
    await this.list();
    return this.cache!.some((f) => favoriteKey(f) === favoriteKey(favorite));
  }

  async add(favorite: Omit<Favorite, "addedOn">): Promise<void> {
    await this.list();
    const key = favoriteKey(favorite);
    const existing = this.cache!.find((f) => favoriteKey(f) === key);
    const row: Favorite = { ...favorite, addedOn: new Date().toISOString() };
    if (existing !== undefined) {
      const idx = this.cache!.indexOf(existing);
      this.cache![idx] = row;
    } else {
      this.cache!.unshift(row);
    }
    await this.store.write(this.cache!);
  }

  async remove(favorite: Pick<Favorite, "id" | "season" | "episode">): Promise<void> {
    await this.list();
    const key = favoriteKey(favorite);
    this.cache = this.cache!.filter((f) => favoriteKey(f) !== key);
    await this.store.write(this.cache!);
  }

  async toggle(favorite: Omit<Favorite, "addedOn">): Promise<boolean> {
    const present = await this.is(favorite);
    if (present) {
      await this.remove(favorite);
      return false;
    }
    await this.add(favorite);
    return true;
  }

  /** Convert a catalog row into a favorite record. */
  fromItem(item: StreamCatalogItem): Omit<Favorite, "addedOn"> {
    return {
      provider: item.provider,
      id: item.id,
      title: item.title,
      mediaType: item.mediaType,
      year: item.year,
      posterUrl: item.posterUrl,
    };
  }
}