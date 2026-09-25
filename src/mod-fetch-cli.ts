import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runLocalServerCli } from "./local-server-cli.js";
import { makeLocalServerConfig, type ModSelection } from "./server-config-cli.js";

const DEFAULT_SCENARIO = "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf";
const DEFAULT_PORT = 25531;
const DEFAULT_DURATION_SECONDS = 120;
const DEFAULT_STARTUP_TIMEOUT_SECONDS = 600;

const USAGE = `Fetch Workshop addons through a private Reforger dedicated server (dry run by default)

  npm run mod:fetch -- --mod WORKSHOP_ID[=Name] [--mod WORKSHOP_ID[=Name] ...] [--profile <isolated-directory>] [--server <ArmaReforgerServer.exe>] [--port 25531] [--duration-seconds 120] [--startup-timeout-seconds 600] [--execute]

The server is hidden, binds only to 127.0.0.1, and stops after the bounded run.
The reusable cache is <profile>/addons; the default profile is .cache/workshop-fetch/profile.
Already cached requested addons skip the server. A successful fetch requires each addon's
addon.gproj to contain the requested GUID and its data.pak to be nonempty.
The bounded server run may last its full duration even after downloads finish.
`;

export interface ModFetchOptions {
  modValues: string[];
  profile: string;
  server?: string;
  port: number;
  durationSeconds: number;
  startupTimeoutSeconds: number;
  execute: boolean;
}

export interface FetchedMod {
  id: string;
  folder?: string;
  dataPakBytes?: number;
}

function parseInteger(raw: string, flag: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${flag} must be an integer from ${min} through ${max}.`);
  }
  return value;
}

function rejectPrimaryClientProfile(profile: string): void {
  const primary = path.resolve(os.homedir(), "Documents", "My Games", "ArmaReforger");
  const normalize = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
  const selected = normalize(path.resolve(profile));
  const root = normalize(primary);
  if (selected === root || selected.startsWith(`${root}${path.sep}`)) {
    throw new Error("--profile must be isolated from the normal ArmaReforger client profile.");
  }
}

export function parseModFetchArgs(argv: string[]): ModFetchOptions {
  const modValues: string[] = [];
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--execute") {
      if (execute) throw new Error("--execute was provided twice.");
      execute = true;
      continue;
    }
    if (!["--mod", "--profile", "--server", "--port", "--duration-seconds", "--startup-timeout-seconds"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${flag}.`);
    if (flag === "--mod") {
      modValues.push(value);
    } else {
      if (values.has(flag)) throw new Error(`${flag} was provided twice.`);
      values.set(flag, value);
    }
  }
  if (modValues.length === 0) throw new Error(`At least one --mod is required.\n\n${USAGE}`);
  const port = parseInteger(values.get("--port") ?? String(DEFAULT_PORT), "--port", 1024, 65535);
  const durationSeconds = parseInteger(values.get("--duration-seconds") ?? String(DEFAULT_DURATION_SECONDS), "--duration-seconds", 1, 3600);
  const startupTimeoutSeconds = parseInteger(values.get("--startup-timeout-seconds") ?? String(DEFAULT_STARTUP_TIMEOUT_SECONDS), "--startup-timeout-seconds", 5, 3600);
  // makeLocalServerConfig checks the IDs, names, duplicate IDs, and loopback config values.
  makeLocalServerConfig(DEFAULT_SCENARIO, modValues, port);
  const profile = path.resolve(values.get("--profile") ?? path.join(".cache", "workshop-fetch", "profile"));
  rejectPrimaryClientProfile(profile);
  return {
    modValues,
    profile,
    server: values.get("--server") ? path.resolve(values.get("--server")!) : undefined,
    port,
    durationSeconds,
    startupTimeoutSeconds,
    execute,
  };
}

async function fileSize(filePath: string): Promise<number | undefined> {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

export async function inspectFetchedMods(mods: ModSelection[], profile: string): Promise<FetchedMod[]> {
  const result = mods.map((mod) => ({ id: mod.modId } as FetchedMod));
  const addonsDir = path.join(profile, "addons");
  let folders;
  try {
    folders = await readdir(addonsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  for (const entry of folders) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(addonsDir, entry.name);
    let project: string;
    try {
      project = await readFile(path.join(folder, "addon.gproj"), "utf8");
    } catch {
      continue;
    }
    const guid = /\bGUID\s+"([0-9A-Fa-f]{16})"/.exec(project)?.[1]?.toUpperCase();
    if (!guid) continue;
    const found = result.find((mod) => mod.id === guid);
    if (!found || found.folder) continue;
    const bytes = await fileSize(path.join(folder, "data.pak"));
    if (bytes === undefined || bytes === 0) continue;
    found.folder = folder;
    found.dataPakBytes = bytes;
  }
  return result;
}

export async function runModFetchCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseModFetchArgs(argv);
  const config = makeLocalServerConfig(DEFAULT_SCENARIO, options.modValues, options.port);
  const before = await inspectFetchedMods(config.game.mods, options.profile);
  process.stdout.write(`Profile: ${options.profile}\nCache: ${path.join(options.profile, "addons")}\n`);
  for (const mod of before) process.stdout.write(`${mod.id}: ${mod.folder ? `cached (${mod.dataPakBytes} bytes)` : "missing"}\n`);
  if (before.every((mod) => mod.folder)) {
    process.stdout.write("All requested addons are already verified in the isolated cache; no server run needed.\n");
    return 0;
  }
  process.stdout.write(`Private server: 127.0.0.1:${options.port}, hidden, Conflict Arland; run limit ${options.durationSeconds} seconds after binding.\n`);
  if (!options.execute) {
    process.stdout.write("Dry run only. Add --execute to fetch missing Workshop addons.\n");
    return 0;
  }
  const runName = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${process.pid}`;
  const runDir = path.resolve(".cache", "workshop-fetch", "runs", runName);
  const configPath = path.join(runDir, "server.json");
  await mkdir(runDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const serverArgs = [
    "--config", configPath,
    "--profile", options.profile,
    "--startup-timeout-seconds", String(options.startupTimeoutSeconds),
    "--duration-seconds", String(options.durationSeconds),
    "--execute",
  ];
  if (options.server) serverArgs.push("--server", options.server);
  const code = await runLocalServerCli(serverArgs);
  if (code !== 0) return code;
  const after = await inspectFetchedMods(config.game.mods, options.profile);
  const missing = after.filter((mod) => !mod.folder);
  if (missing.length > 0) {
    throw new Error(`Workshop fetch incomplete: ${missing.map((mod) => mod.id).join(", ")} lack a matching addon.gproj GUID and nonempty data.pak in ${path.join(options.profile, "addons")}.`);
  }
  for (const mod of after) process.stdout.write(`Verified ${mod.id}: ${mod.folder} (${mod.dataPakBytes} bytes)\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runModFetchCli().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
