/**
 * CLI argument parsing. Small, dependency-free, and fully tested.
 */

export const COMMANDS = [
  "search",
  "downloads",
  "config",
  "magnet",
  "infohash",
  "file",
  "watch",
  "sources",
  "doctor",
  "help",
  "version",
  "tui",
] as const;

export type Command = (typeof COMMANDS)[number];

export interface CliArgs {
  command: Command | null;
  positional: string[];
  json: boolean;
  help: boolean;
  version: boolean;
  quiet: boolean;
  wait: boolean;
  sources: string[];
  limit: number | null;
  dir: string | null;
  seed: boolean | null;
  priority: number | null;
  category: string | null;
  check: boolean;
}

export function defaultArgs(): CliArgs {
  return {
    command: null,
    positional: [],
    json: false,
    help: false,
    version: false,
    quiet: false,
    wait: true,
    sources: [],
    limit: null,
    dir: null,
    seed: null,
    priority: null,
    category: null,
    check: false,
  };
}

export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgError";
  }
}

function numberFlag(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new CliArgError(`${name} expects a non-negative number`);
  return n;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args = defaultArgs();
  const positional: string[] = [];
  const commandArg = (cmd: string): void => {
    if (args.command !== null) throw new CliArgError(`Unexpected command "${cmd}" (only one command is allowed)`);
    if (!(COMMANDS as readonly string[]).includes(cmd)) {
      throw new CliArgError(`Unknown command "${cmd}". Run \`tornedo help\` for usage.`);
    }
    args.command = cmd as Command;
  };

  let i = 0;
  while (i < argv.length) {
    const raw = argv[i]!;
    if (raw === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (raw.startsWith("--")) {
      const eq = raw.indexOf("=");
      const name = eq >= 0 ? raw.slice(2, eq) : raw.slice(2);
      const inline = eq >= 0 ? raw.slice(eq + 1) : undefined;
      const next = (): string => {
        if (inline !== undefined) return inline;
        if (i + 1 >= argv.length) throw new CliArgError(`Flag --${name} expects a value`);
        return argv[++i]!;
      };
      switch (name) {
        case "json":
          args.json = true;
          break;
        case "help":
          args.help = true;
          break;
        case "version":
          args.version = true;
          break;
        case "quiet":
          args.quiet = true;
          break;
        case "no-wait":
          args.wait = false;
          break;
        case "wait":
          args.wait = true;
          break;
        case "source":
          args.sources.push(next());
          break;
        case "limit":
          args.limit = numberFlag(next(), "--limit");
          break;
        case "dir":
          args.dir = next();
          break;
        case "seed":
          args.seed = true;
          break;
        case "no-seed":
          args.seed = false;
          break;
        case "priority":
          args.priority = numberFlag(next(), "--priority");
          break;
        case "category":
          args.category = next();
          break;
        case "check":
          args.check = true;
          break;
        default:
          throw new CliArgError(`Unknown flag --${name}`);
      }
      i++;
      continue;
    }
    if (raw.startsWith("-") && raw.length > 1) {
      for (const ch of raw.slice(1)) {
        switch (ch) {
          case "j":
            args.json = true;
            break;
          case "h":
            args.help = true;
            break;
          case "q":
            args.quiet = true;
            break;
          case "V":
            args.version = true;
            break;
          default:
            throw new CliArgError(`Unknown flag -${ch}`);
        }
      }
      i++;
      continue;
    }
    positional.push(raw);
    i++;
  }

  if (positional.length > 0 && args.command === null) {
    commandArg(positional[0]!);
    positional.shift();
  }
  args.positional = positional;
  return args;
}
