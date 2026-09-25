import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runLocalServerCli } from "./local-server-cli.js";
import { makeLocalServerConfig } from "./server-config-cli.js";

export const CONFLICT_ARLAND_SCENARIO = "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf";
const DEFAULT_PORT = 2001;
const DEFAULT_DURATION_SECONDS = 3600;
const DEFAULT_STARTUP_TIMEOUT_SECONDS = 600;
const REUSABLE_PROFILE = path.resolve(".cache", "workshop-fetch", "profile");

const USAGE = `Host a private Conflict Arland test with the guarded dedicated server (dry run by default)

  npm run conflict:host -- --mod WORKSHOP_ID[=Name] [--mod WORKSHOP_ID[=Name] ...] [--scenario '{GUID}Missions/Scenario.conf'] [--port 2001] [--duration-seconds 3600 | --keep-open] [--startup-timeout-seconds 600] [--server <ArmaReforgerServer.exe>] [--execute]

The server binds only to 127.0.0.1 and is hidden from the server browser.
It reuses .cache/workshop-fetch/profile and stops after the bounded run or Ctrl+C.
Use --keep-open for a player handoff without an automatic timer; Ctrl+C still stops it.
The guarded runner checks live UDP listeners and prints the exact per-run log path.
`;

export interface ConflictHostOptions {
  modValues: string[];
  scenarioId: string;
  port: number;
  durationSeconds?: number;
  startupTimeoutSeconds: number;
  server?: string;
  execute: boolean;
}

function parseInteger(raw: string, flag: string, minimum: number, maximum: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function parseConflictHostArgs(argv: string[]): ConflictHostOptions {
  const modValues: string[] = [];
  const values = new Map<string, string>();
  let execute = false;
  let keepOpen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--execute") {
      if (execute) throw new Error("--execute was provided twice.");
      execute = true;
      continue;
    }
    if (flag === "--keep-open") {
      if (keepOpen) throw new Error("--keep-open was provided twice.");
      keepOpen = true;
      continue;
    }
    if (!["--mod", "--scenario", "--port", "--duration-seconds", "--startup-timeout-seconds", "--server"].includes(flag)) {
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
  if (keepOpen && values.has("--duration-seconds")) {
    throw new Error("Choose either --duration-seconds or --keep-open.");
  }
  const port = parseInteger(values.get("--port") ?? String(DEFAULT_PORT), "--port", 1024, 65535);
  const scenarioId = values.get("--scenario") ?? CONFLICT_ARLAND_SCENARIO;
  const durationSeconds = keepOpen
    ? undefined
    : parseInteger(values.get("--duration-seconds") ?? String(DEFAULT_DURATION_SECONDS), "--duration-seconds", 1, 3600);
  const startupTimeoutSeconds = parseInteger(values.get("--startup-timeout-seconds") ?? String(DEFAULT_STARTUP_TIMEOUT_SECONDS), "--startup-timeout-seconds", 5, 3600);
  // Also validates mod IDs, names, duplicates, and the fixed private scenario config.
  makeLocalServerConfig(scenarioId, modValues, port);
  return {
    modValues,
    scenarioId,
    port,
    durationSeconds,
    startupTimeoutSeconds,
    server: values.get("--server") ? path.resolve(values.get("--server")!) : undefined,
    execute,
  };
}

export function makeConflictHostServerArgs(options: ConflictHostOptions, configPath: string): string[] {
  const serverArgs = [
    "--config", configPath,
    "--profile", REUSABLE_PROFILE,
    "--startup-timeout-seconds", String(options.startupTimeoutSeconds),
    "--execute",
  ];
  if (options.durationSeconds !== undefined) serverArgs.push("--duration-seconds", String(options.durationSeconds));
  if (options.server) serverArgs.push("--server", options.server);
  return serverArgs;
}

export async function runConflictHostCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseConflictHostArgs(argv);
  const config = makeLocalServerConfig(options.scenarioId, options.modValues, options.port);
  process.stdout.write(`Scenario: ${options.scenarioId === CONFLICT_ARLAND_SCENARIO ? "Conflict - Arland " : ""}(${config.game.scenarioId})\n`);
  process.stdout.write(`Mods: ${config.game.mods.map((mod) => `${mod.name} (${mod.modId})`).join(", ")}\n`);
  process.stdout.write(`Private host: 127.0.0.1:${options.port}, hidden; ${options.durationSeconds === undefined ? "runs until Ctrl+C or server exit" : `maximum ${options.durationSeconds} seconds after binding`}.\n`);
  process.stdout.write(`Reusable server profile: ${REUSABLE_PROFILE}\n`);
  process.stdout.write(`To test as a player, try Reforger Multiplayer > Direct Connect to 127.0.0.1:${options.port}. Confirm the player enters Conflict before evaluating the mod; earlier automatic local joins timed out during authentication.\n`);
  if (!options.execute) {
    process.stdout.write("Dry run only. Add --execute to create the private config and start the guarded server; it will print the exact log path.\n");
    return 0;
  }

  const runName = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${process.pid}`;
  const runDir = path.resolve(".cache", "conflict-host", "runs", runName);
  const configPath = path.join(runDir, "server.json");
  await mkdir(runDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return runLocalServerCli(makeConflictHostServerArgs(options, configPath));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runConflictHostCli().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
