/**
 * `tornedo tv [list|add|remove|clear|search|test]` — manage live-TV playlists
 * (m3u8 URLs or local files) used by Watch mode.
 */
import { loadM3u, groupChannels, type TvPlaylist } from "../../stream/tv.js";
import type { CliContext } from "../context.js";

export async function runTv(ctx: CliContext, positional: readonly string[]): Promise<number> {
  const sub = positional[0] ?? "list";
  const app = ctx.app;
  switch (sub) {
    case "list":
      return list(ctx);
    case "add":
      return add(ctx, positional[1], positional[2]);
    case "remove":
      return remove(ctx, positional[1]);
    case "clear":
      await app.setStreamTvPlaylists([]);
      ctx.log("Live-TV playlists cleared.");
      return 0;
    case "search":
      return search(ctx, positional[1] ?? "");
    case "test":
      return test(ctx, positional[1]);
    default:
      ctx.err(`tornedo tv: unknown subcommand "${sub}". Use: list | add <url> [name] | remove <name|url> | clear | search <q> | test <url>`);
      return 1;
  }
}

async function list(ctx: CliContext): Promise<number> {
  const playlists = await ctx.app.streamTvPlaylists();
  if (ctx.args.json) {
    ctx.jsonOut(playlists);
    return playlists.length;
  }
  if (playlists.length === 0) {
    ctx.log("No live-TV playlists configured yet.");
    ctx.log("Add one with: tornedo tv add <m3u8-url-or-file> [name]");
    return 0;
  }
  ctx.log(`Live-TV playlists (${playlists.length}):`);
  playlists.forEach((p, i) => ctx.log(`  ${i + 1}. ${p.name}  ->  ${p.url}`));
  return playlists.length;
}

async function add(ctx: CliContext, url: string | undefined, name: string | undefined): Promise<number> {
  const raw = (url ?? "").trim();
  if (raw.length === 0) {
    ctx.err("tornedo tv add <url> [name]");
    return 1;
  }
  if (!looksLikePlaylist(raw)) {
    ctx.err(`"${raw}" is not an http(s) URL or an existing file path.`);
    return 1;
  }
  const playlists = await ctx.app.streamTvPlaylists();
  if (playlists.some((p) => p.url === raw)) {
    ctx.log(`Playlist already configured: ${raw}`);
    return 1;
  }
  const entry: TvPlaylist = {
    name: (name ?? "").trim().length > 0 ? name!.trim() : hostOf(raw),
    url: raw,
  };
  await ctx.app.setStreamTvPlaylists([...playlists, entry]);
  if (ctx.args.json) ctx.jsonOut(entry);
  else ctx.log(`Added live-TV playlist "${entry.name}" (${playlists.length + 1} total).`);
  return 0;
}

async function remove(ctx: CliContext, arg: string | undefined): Promise<number> {
  const q = (arg ?? "").trim().toLowerCase();
  if (q.length === 0) {
    ctx.err("tornedo tv remove <name|url>");
    return 1;
  }
  const playlists = await ctx.app.streamTvPlaylists();
  const rest = playlists.filter((p) => !(p.name.toLowerCase() === q || p.url.toLowerCase() === q || p.url.toLowerCase().includes(q)));
  const removed = playlists.length - rest.length;
  if (removed === 0) {
    ctx.log(`No playlist matched "${q}".`);
    return 1;
  }
  await ctx.app.setStreamTvPlaylists(rest);
  ctx.log(`Removed ${removed} playlist${removed === 1 ? "" : "s"} (${rest.length} remain).`);
  return 0;
}

async function search(ctx: CliContext, query: string): Promise<number> {
  if (ctx.app.streams.tvPlaylistCount === 0) {
    ctx.log("No live-TV playlists configured. Run: tornedo tv list");
    return 0;
  }
  const items = await ctx.app.streams.searchTv(query);
  if (ctx.args.json) {
    ctx.jsonOut(items.map((it) => ({ title: it.title, group: it.extra?.["group"] ?? null, url: it.extra?.["streamUrl"] ?? null })));
    return items.length;
  }
  if (items.length === 0) {
    ctx.log(`No live-TV channels match "${query}".`);
    return 0;
  }
  ctx.log(`Live-TV channels for "${query}" (${items.length}):`);
  items.forEach((it, i) => {
    const group = it.extra?.["group"] ?? "TV";
    ctx.log(`  ${i + 1}. ${it.title}  [${String(group)}]`);
  });
  return items.length;
}

async function test(ctx: CliContext, url: string | undefined): Promise<number> {
  const raw = (url ?? "").trim();
  if (raw.length === 0) {
    ctx.err("tornedo tv test <m3u8-url-or-file>");
    return 1;
  }
  let channels;
  try {
    channels = await loadM3u(raw);
  } catch (err) {
    ctx.err(`Could not load playlist: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const groups = groupChannels(channels);
  if (ctx.args.json) {
    ctx.jsonOut({ url: raw, channels: channels.length, groups: [...groups.entries()].map(([name, list]) => ({ name, count: list.length })) });
  } else {
    ctx.log(`Loaded ${channels.length} channels, ${groups.size} groups.`);
    for (const [name, list] of groups) ctx.log(`  ${name}: ${list.length}`);
  }
  return channels.length;
}

function looksLikePlaylist(raw: string): boolean {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return true;
  // A local file: accept anything that resolves to an existing file.
  return /[/\\]/.test(raw);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url.split(/[/\\]/).pop() ?? url;
  }
}