import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { discoverSteamLibraries } from "./doctor.js";

const execFileAsync = promisify(execFile);
const LOOPBACK = "127.0.0.1";
const DEFAULT_STARTUP_TIMEOUT_SECONDS = 600;
const POLL_INTERVAL_MS = 500;

const USAGE = `Guarded local Reforger dedicated server launcher (dry run by default)

  npm run server:run -- --config <server.json> [--server <ArmaReforgerServer.exe>] [--profile <directory>] [--startup-timeout-seconds 600] [--duration-seconds 30] [--execute]

The JSON must bind and advertise only 127.0.0.1 and set game.visible to false.
Use a high, non-forwarded bind port. --server names the executable; the game's -server flag is never used.
On Windows, --execute checks the server process's UDP endpoints and stops it if any are not loopback.
`;

export interface LocalServerOptions {
  config: string;
  server?: string;
  profile?: string;
  execute: boolean;
  startupTimeoutSeconds: number;
  durationSeconds?: number;
}

export interface UdpEndpoint {
  LocalAddress: string;
  LocalPort: number;
}

export interface LocalServerPlan {
  executable: string;
  args: string[];
  config: string;
  profile: string;
  logsDir: string;
  startupTimeoutSeconds: number;
  durationSeconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePort(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new Error(`${label} must be an integer port from 1 through 65535.`);
  }
  return value as number;
}

export function validateLocalServerConfig(value: unknown): void {
  if (!isRecord(value)) throw new Error("Server config must be a JSON object.");
  if (value.bindAddress !== LOOPBACK) throw new Error("bindAddress must be 127.0.0.1.");
  if (value.publicAddress !== LOOPBACK) throw new Error("publicAddress must be 127.0.0.1.");
  const bindPort = validatePort(value.bindPort, "bindPort");
  const publicPort = validatePort(value.publicPort, "publicPort");
  if (bindPort !== publicPort) throw new Error("bindPort and publicPort must match for a local run.");
  if (!isRecord(value.game) || value.game.visible !== false) {
    throw new Error("game.visible must be false.");
  }
  if (typeof value.game.scenarioId !== "string" || !/^\{[0-9A-Fa-f]{16}\}.+\.conf$/.test(value.game.scenarioId)) {
    throw new Error("game.scenarioId must be a complete {GUID}...conf scenario ID.");
  }
  for (const key of ["a2s", "rcon"] as const) {
    if (value[key] !== undefined && (!isRecord(value[key]) || value[key].address !== LOOPBACK)) {
      throw new Error(`${key}.address must be 127.0.0.1 when ${key} is configured.`);
    }
  }
  for (const key of ["gameHostBindAddress", "gameHostRegisterBindAddress", "a2sIpAddress"]) {
    if (key in value) throw new Error(`Remove legacy network setting ${key} from the local config.`);
  }
}

function parseBoundedSeconds(raw: string, flag: string, minimum: number, maximum: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function parseLocalServerArgs(argv: string[]): LocalServerOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--execute") {
      if (execute) throw new Error("--execute was provided twice.");
      execute = true;
      continue;
    }
    if (!["--config", "--server", "--profile", "--startup-timeout-seconds", "--duration-seconds"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`Expected one value for ${flag}.`);
    }
    values.set(flag, value);
  }
  const config = values.get("--config");
  if (!config) throw new Error(`Missing --config.\n\n${USAGE}`);
  return {
    config: path.resolve(config),
    server: values.get("--server") ? path.resolve(values.get("--server")!) : undefined,
    profile: values.get("--profile") ? path.resolve(values.get("--profile")!) : undefined,
    execute,
    startupTimeoutSeconds: values.has("--startup-timeout-seconds")
      ? parseBoundedSeconds(values.get("--startup-timeout-seconds")!, "--startup-timeout-seconds", 5, 3600)
      : DEFAULT_STARTUP_TIMEOUT_SECONDS,
    durationSeconds: values.has("--duration-seconds")
      ? parseBoundedSeconds(values.get("--duration-seconds")!, "--duration-seconds", 1, 3600)
      : undefined,
  };
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function findServerExecutable(override?: string): Promise<string> {
  const requested = override ?? process.env.REFORGER_SERVER_EXE;
  if (requested) {
    const resolved = path.resolve(requested);
    if (!(await isFile(resolved))) throw new Error(`Dedicated server executable does not exist: ${resolved}`);
    return resolved;
  }
  const libraries = await discoverSteamLibraries();
  for (const library of libraries) {
    for (const candidate of [
      path.join(library, "reforger-automation", "server", "ArmaReforgerServer.exe"),
      path.join(library, "steamapps", "common", "Arma Reforger Server", "ArmaReforgerServer.exe"),
      path.join(library, "steamapps", "common", "Arma Reforger", "ArmaReforgerServer.exe"),
    ]) {
      if (await isFile(candidate)) return candidate;
    }
  }
  throw new Error("Dedicated server executable was not found. Pass --server <path> or set REFORGER_SERVER_EXE.");
}

export function makeLocalServerPlan(options: LocalServerOptions, executable: string, runDir: string): LocalServerPlan {
  const profile = options.profile ?? path.join(runDir, "profile");
  const logsDir = path.join(runDir, "logs");
  return {
    executable,
    args: ["-config", options.config, "-profile", profile, "-logsDir", logsDir, "-maxFPS", "60"],
    config: options.config,
    profile,
    logsDir,
    startupTimeoutSeconds: options.startupTimeoutSeconds,
    durationSeconds: options.durationSeconds,
  };
}

function formatPowerShellCommand(plan: LocalServerPlan): string {
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  return `& ${[plan.executable, ...plan.args].map(quote).join(" ")}`;
}

export function parseUdpEndpoints(output: string): UdpEndpoint[] {
  if (!output.trim()) return [];
  const parsed: unknown = JSON.parse(output);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.LocalAddress !== "string" || !Number.isInteger(entry.LocalPort)) {
      throw new Error("Could not parse the server's UDP endpoint data.");
    }
    return { LocalAddress: entry.LocalAddress, LocalPort: entry.LocalPort as number };
  });
}

export function unsafeUdpEndpoints(endpoints: UdpEndpoint[]): UdpEndpoint[] {
  return endpoints.filter((endpoint) => endpoint.LocalAddress !== LOOPBACK && endpoint.LocalAddress !== "::1");
}

async function getWindowsUdpEndpoints(pid: number): Promise<UdpEndpoint[]> {
  const script = `$ErrorActionPreference='Stop'; $ports=@(Get-NetUDPEndpoint -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort); ConvertTo-Json -InputObject $ports -Compress`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 10_000,
    windowsHide: true,
  });
  return parseUdpEndpoints(stdout);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(5_000).then(() => undefined),
  ]);
  if (child.exitCode === null && child.signalCode === null && child.pid) child.kill("SIGKILL");
}

async function executeLocalServer(plan: LocalServerPlan): Promise<number> {
  if (process.platform !== "win32") {
    throw new Error("--execute currently requires Windows so UDP binding can be verified by process ID.");
  }
  await mkdir(plan.profile, { recursive: true });
  await mkdir(plan.logsDir, { recursive: true });
  const child = spawn(plan.executable, plan.args, {
    cwd: path.dirname(plan.executable),
    stdio: "ignore",
    windowsHide: true,
  });
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  const startedAt = Date.now();
  let boundAt: number | undefined;
  try {
    while (true) {
      if (spawnError) throw spawnError;
      if (interrupted) {
        process.stdout.write("Interrupted; stopping local server.\n");
        return 130;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Server exited before the local run completed (exit ${child.exitCode ?? child.signalCode}). Logs: ${plan.logsDir}`);
      }
      if (!child.pid) throw new Error("Server process did not provide a process ID.");
      const endpoints = await getWindowsUdpEndpoints(child.pid);
      const unsafe = unsafeUdpEndpoints(endpoints);
      if (unsafe.length > 0) {
        throw new Error(`Server opened a non-loopback UDP endpoint (${unsafe.map((endpoint) => `${endpoint.LocalAddress}:${endpoint.LocalPort}`).join(", ")}); stopping it. Logs: ${plan.logsDir}`);
      }
      if (endpoints.length > 0 && boundAt === undefined) {
        boundAt = Date.now();
        process.stdout.write(`Verified loopback UDP listener: ${endpoints.map((endpoint) => `${endpoint.LocalAddress}:${endpoint.LocalPort}`).join(", ")}\n`);
      }
      if (boundAt === undefined && Date.now() - startedAt > plan.startupTimeoutSeconds * 1_000) {
        throw new Error(`Server did not open a loopback UDP listener within ${plan.startupTimeoutSeconds} seconds. Logs: ${plan.logsDir}`);
      }
      if (boundAt !== undefined && plan.durationSeconds !== undefined && Date.now() - boundAt >= plan.durationSeconds * 1_000) {
        process.stdout.write(`Completed ${plan.durationSeconds}-second local run; stopping server. Logs: ${plan.logsDir}\n`);
        return 0;
      }
      await delay(POLL_INTERVAL_MS);
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    await stopChild(child);
  }
}

export async function runLocalServerCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseLocalServerArgs(argv);
  let config: unknown;
  try {
    config = JSON.parse(await readFile(options.config, "utf8"));
  } catch (error) {
    throw new Error(`Could not read server JSON config ${options.config}: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateLocalServerConfig(config);
  const executable = await findServerExecutable(options.server);
  const runName = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${process.pid}`;
  const runDir = path.resolve(".cache", "local-server", "runs", runName);
  const plan = makeLocalServerPlan(options, executable, runDir);
  process.stdout.write(`Config: ${plan.config}\nProfile: ${plan.profile}\nLogs: ${plan.logsDir}\n`);
  process.stdout.write(`Command: ${formatPowerShellCommand(plan)}\n`);
  if (!options.execute) {
    process.stdout.write("Dry run only. Add --execute to start the loopback server.\n");
    return 0;
  }
  return executeLocalServer(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLocalServerCli().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
