/**
 * Public programmatic API. The CLI/TUI build on the same surface.
 */
export { Application, type ApplicationOptions } from "./app/application.js";
export { SearchService, SearchSession, type SourceReport, type SearchFailure } from "./app/search-service.js";
export { SearchEngine, type SearchEngineOptions } from "./search/engine.js";
export { TorrentManager, type TorrentManagerOptions } from "./downloads/manager.js";
export { TorrentStore } from "./database/store.js";
export { openInMemory, openDatabase, openInMemoryHandle } from "./database/db.js";
export { WatchService, type WatchAdd } from "./watch/watcher.js";

export {
  defaultConfig,
  normalizeConfig,
  loadConfig,
  saveConfig,
  defaultKeybindings,
  KEY_ACTIONS,
  type TornedoConfig,
  type RankingConfig,
  type KeyAction,
} from "./config/config.js";
export { configFile, dbFile, defaultDownloadDir } from "./config/paths.js";

export { analyzeQuery, isConfident, describeInference } from "./media/query.js";
export { toMediaEntity, formatEntity } from "./media/entity.js";
export { parseTitle } from "./media/title.js";
export { classifyMedia } from "./media/classify.js";

export {
  defaultSortSpec,
  SORT_OPTIONS,
  describeFilter,
  sortLabel,
  parseFilterText,
  filterToQueryText,
  sortReleases,
  releaseMatches,
  type ReleaseFilter,
  type SortSpec,
  type SortOption,
} from "./results/filter.js";
export {
  buildReleases,
  buildGroups,
  applyFilter,
  sortBySpec,
  defaultRankContext,
  type PipelineOptions,
} from "./results/pipeline.js";
export { runDoctor, renderDoctor, type DoctorReport, type DoctorCheck } from "./diagnostics/doctor.js";

export type {
  MediaCategory,
  Release,
  ReleaseGroup,
  SearchResult,
  NormalizedResult,
  ReleaseMetadata,
  AudioMetadata,
  InferredQuery,
  MediaEntity,
  GameMetadata,
} from "./model/search.js";
export type {
  TorrentItem,
  TorrentStatus,
  TorrentStats,
  TorrentMeta,
  AddTorrentInput,
  DownloadSummary,
  RecoveryReport,
} from "./model/torrent.js";
export type { SourceAdapter, SourceGroup, SearchContext, SearchEmitter, SearchSummary, SearchRequest, SourceFailure } from "./model/source.js";
export { normalizeInfoHash, buildMagnet, parseInput, parseMagnet, parseTorrentBuffer } from "./torrent/parse.js";
export { formatBytes, formatRate, formatPercent } from "./utils/bytes.js";
export { formatDuration, progressBar } from "./utils/duration.js";
export { sanitizeSegment, safeFolderName, isSafeRelativePath, joinSafe } from "./utils/sanitize.js";
export { VERSION } from "./version.js";