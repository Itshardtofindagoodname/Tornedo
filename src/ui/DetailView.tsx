/**
 * Result inspector: a focused view of one search result, opened with enter from
 * the results list. Everything shown comes from the real release (parsed
 * metadata, swarm counts, sources, magnet). File listings are NOT invented —
 * until the torrent is added the source only knows a file count, so that state
 * is shown explicitly.
 */
import { Box, Text } from "ink";
import type { Application } from "../app/application.js";
import type { Release } from "../model/search.js";
import { formatAudio } from "../media/audio.js";
import { formatBytes } from "../utils/bytes.js";
import { formatDate, truncate } from "../utils/duration.js";
import { categoryColor, categoryTag } from "./format.js";
import { KeyValue, Separator } from "./components.js";
import { palette } from "./theme.js";

export interface DetailViewProps {
  app: Application;
  release: Release;
}

export function DetailView({ app, release }: DetailViewProps): React.ReactNode {
  const md = release.metadata;
  const sourceNames = new Map(app.sources.map((s) => [s.id, s.name]));
  const sources = release.sources.map((s) => sourceNames.get(s) ?? s).join(", ");
  const audio = formatAudio(md.audio);

  const spec = [
    md.quality,
    md.resolution,
    md.codec,
    md.container,
    md.source,
    md.group,
    audio,
  ]
    .filter(Boolean)
    .join(" · ");

  const tags: string[] = [];
  if (md.year) tags.push(`${md.year}`);
  if (md.season) tags.push(`S${String(md.season).padStart(2, "0")}`);
  if (md.episode) tags.push(`E${String(md.episode).padStart(2, "0")}`);
  if (md.episodeRange) tags.push(`episodes ${md.episodeRange}`);
  if (md.languages?.length) tags.push(md.languages.join("/"));
  if (md.subtitles?.length) tags.push(`subs ${md.subtitles.join("/")}`);
  if (md.edition?.length) tags.push(md.edition.join(", "));
  if (md.hdr) tags.push("HDR");
  if (md.is3d) tags.push("3D");
  if (md.game?.platform) tags.push(md.game.platform);
  if (md.game?.version) tags.push(md.game.version);
  if (md.artist) tags.push(`by ${md.artist}`);
  if (md.album) tags.push(`album ${md.album}`);
  if (md.track) tags.push(`track ${md.track}`);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      <Text color={palette.dim}>← search results</Text>

      <Box marginTop={1}>
        <Text bold color={palette.text}>
          {release.title}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Separator />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.accentBright} bold>
          {formatBytes(release.size)}
        </Text>
        <Box height={1}>
          <Text color={palette.subtext}>
            {release.seeders ?? "–"} seeds · {release.leechers ?? "–"} peers · {release.files ?? "–"} files
          </Text>
        </Box>
        <Box height={1}>
          <Text color={palette.subtext}>
            {release.sources.length} source{release.sources.length === 1 ? "" : "s"}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Separator />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {spec ? (
          <KeyValue label="specs" value={truncate(spec, 120)} valueColor={palette.text} />
        ) : null}
        {tags.length > 0 ? (
          <KeyValue label="tags" value={truncate(tags.join("  ·  "), 120)} valueColor={palette.text} />
        ) : null}
        {release.category ? (
          <KeyValue
            label="category"
            value={
              <Text color={categoryColor(release.category)}>
                {categoryTag(release.category).trim()} {release.category}
              </Text>
            }
            valueColor={palette.text}
          />
        ) : null}
        <KeyValue label="sources" value={truncate(sources, 120)} valueColor={palette.text} />
        <KeyValue label="infohash" value={truncate(release.infohash, 24)} valueColor={palette.dim} />
        <KeyValue label="magnet" value={truncate(release.magnet, 120)} valueColor={palette.dim} />
        {release.added ? (
          <KeyValue label="added" value={formatDate(release.added)} valueColor={palette.subtext} />
        ) : null}
      </Box>

      <Box marginTop={1}>
        <Separator />
      </Box>

      <Box marginTop={1}>
        <Text color={palette.faint}>
          {release.files !== undefined
            ? `${release.files} file${release.files === 1 ? "" : "s"} — the file listing is only known once the torrent metadata is resolved.`
            : "file listing unknown until the torrent metadata is resolved."}
        </Text>
      </Box>

      <Box flexGrow={1} />

      <Box marginBottom={1}>
        <Text color={palette.dim}>
          <Text color={palette.accent} bold>enter</Text> download
          {"  "}
          <Text color={palette.accent} bold>d</Text> download
          {"  "}
          <Text color={palette.accent} bold>D</Text> download to…
          {"  "}
          <Text color={palette.accent} bold>c</Text> copy magnet
          {"  "}
          <Text color={palette.accent} bold>o</Text> open magnet
          {"  "}
          <Text color={palette.accent} bold>esc</Text> back
        </Text>
      </Box>
    </Box>
  );
}