/**
 * WatchSearchSession runs a streaming search across all enabled providers
 * concurrently, publishing per-provider progress so the UI can render a
 * spinner state before the merged results arrive. Cancellation aborts the
 * in-flight provider requests.
 */
import { StreamCatalogItem } from "./models.js";
import { StreamService } from "./service.js";

export interface ProviderStatus {
  name: string;
  state: "idle" | "running" | "done" | "error";
  count: number;
  message?: string;
}

export class WatchSearchSession {
  readonly query: string;
  results: StreamCatalogItem[] = [];
  providerStatus: ProviderStatus[] = [
    { name: "moviebox", state: "idle", count: 0 },
    { name: "fourkhdhub", state: "idle", count: 0 },
    { name: "addons", state: "idle", count: 0 },
    { name: "tv", state: "idle", count: 0 },
  ];
  errors: { provider: string; message: string }[] = [];
  done = false;
  onChange?: () => void;

  private readonly abort = new AbortController();

  constructor(
    private readonly service: StreamService,
    query: string,
    onChanged?: () => void,
  ) {
    this.query = query;
    this.onChange = onChanged;
  }

  get selected(): StreamCatalogItem | null {
    const idx = this.cursor;
    return this.results[idx] ?? null;
  }

  private cursor = 0;

  get index(): number {
    return this.cursor;
  }

  setIndex(idx: number): void {
    this.cursor = Math.max(0, Math.min(this.results.length - 1, idx));
    this.onChange?.();
  }

  move(delta: number): void {
    this.setIndex(this.cursor + delta);
  }

  cancel(): void {
    this.abort.abort();
  }

  async run(): Promise<void> {
    this.setIndex(0);
    for (const status of this.providerStatus) status.state = "running";
    this.emit();
    try {
      const { items, errors } = await this.service.searchAll(this.query, this.abort.signal);
      this.results = items;
      this.errors = errors;
      const counts = new Map<string, number>();
      for (const item of items) counts.set(item.provider, (counts.get(item.provider) ?? 0) + 1);
      for (const status of this.providerStatus) {
        status.count = counts.get(status.name) ?? 0;
        status.state = errors.some((e) => e.provider === status.name) ? "error" : "done";
      }
    } finally {
      this.done = true;
      this.emit();
    }
  }

  private emit(): void {
    this.onChange?.();
  }
}