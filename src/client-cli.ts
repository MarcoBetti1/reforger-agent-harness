import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { discoverSteamLibraries } from "./doctor.js";

const USAGE = `Isolated Arma Reforger client launcher (dry run by default)

  npm run client:run -- [--game <ArmaReforgerSteam.exe>] [--profile <directory>] [--run-dir <new-directory>] [--addon <16-hex-ID> ...] [--addons-dir <directory> ...] [--world <world.ent> | --connect-local] [--duration-seconds 600 | --keep-open] [--expect-game] [--execute]

The client receives a separate profile and log directory. Workshop downloads are cached under the profile root's addons subdirectory, so reusing --profile also reuses downloaded mods.
The default test window is 1280 x 720 at a 60 FPS cap.
--connect-local uses Bohemia's documented -client 127.0.0.1 syntax for the default server port.
Client CLI syntax for a non-default server port and the in-game Direct Connect flow are unverified here.
--expect-game requires the current console.log to record a transition to GAME before the bounded run succeeds.
--keep-open removes the time limit for a player handoff; the launcher monitors logs until the game exits or you interrupt it with Ctrl+C.
--run-dir pins the logs and default profile location for a repeatable test. Its console.log must not already exist.
`;

export interface ClientOptions {
  game?: string;
  profile?: string;
  runDir?: string;
  addonIds: string[];
  addonsDirs: string[];
  world?: string;
  connectLocal: boolean;
  expectGame: boolean;
  durationSeconds: number;
  keepOpen: boolean;
  execute: boolean;
}

export interface ClientPlan {
  executable: string;
  cwd: string;
  profile: string;
  logsDir: string;
  downloadDir: string;
  args: string[];
  durationSeconds: number;
  keepOpen: boolean;
  expectGame: boolean;
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function rejectPrimaryClientProfile(profile: string): void {
  const primaryRoot = path.join(os.homedir(), "Documents", "My Games", "ArmaReforger");
  const selected = normalizePath(profile);
  if (selected === normalizePath(primaryRoot) || selected === normalizePath(path.join(primaryRoot, "profile"))) {
    throw new Error("--profile must not point to the normal ArmaReforger profile. Choose an isolated test directory.");
  }
}

export function parseClientArgs(argv: string[]): ClientOptions {
  const values = new Map<string, string>();
  const addonIds: string[] = [];
  const addonsDirs: string[] = [];
  let connectLocal = false;
  let expectGame = false;
  let keepOpen = false;
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--execute" || flag === "--connect-local" || flag === "--expect-game" || flag === "--keep-open") {
      if (flag === "--execute") {
        if (execute) throw new Error("--execute was provided twice.");
        execute = true;
      } else if (flag === "--connect-local") {
        if (connectLocal) throw new Error("--connect-local was provided twice.");
        connectLocal = true;
      } else if (flag === "--keep-open") {
        if (keepOpen) throw new Error("--keep-open was provided twice.");
        keepOpen = true;
      } else {
        if (expectGame) throw new Error("--expect-game was provided twice.");
        expectGame = true;
      }
      continue;
    }
    if (!["--game", "--profile", "--run-dir", "--addon", "--addons-dir", "--world", "--duration-seconds"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${flag}.`);
    if (flag === "--addon") {
      const id = value.trim().toUpperCase();
      if (!/^[0-9A-F]{16}$/.test(id)) throw new Error(`Invalid addon ID: ${value}. Expected 16 hexadecimal characters.`);
      addonIds.push(id);
    } else if (flag === "--addons-dir") {
      if (value.includes(",")) throw new Error("--addons-dir paths cannot contain commas.");
      addonsDirs.push(path.resolve(value));
    } else {
      if (values.has(flag)) throw new Error(`${flag} was provided twice.`);
      values.set(flag, value);
    }
  }

  if (new Set(addonIds).size !== addonIds.length) throw new Error("Duplicate addon IDs are not allowed.");
  const world = values.get("--world");
  if (world && !world.toLowerCase().endsWith(".ent")) throw new Error("--world must name a .ent world resource.");
  if (world && connectLocal) throw new Error("--world and --connect-local cannot be combined.");
  const durationRaw = values.get("--duration-seconds") ?? "600";
  const durationSeconds = Number(durationRaw);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 7200) {
    throw new Error("--duration-seconds must be an integer from 5 through 7200.");
  }
  if (keepOpen && values.has("--duration-seconds")) {
    throw new Error("--keep-open and --duration-seconds cannot be combined.");
  }
  const profile = values.get("--profile") ? path.resolve(values.get("--profile")!) : undefined;
  if (profile) rejectPrimaryClientProfile(profile);
  if (addonIds.length > 0 && addonsDirs.length === 0 && !profile) {
    throw new Error("--addon requires --addons-dir or --profile pointing to an isolated profile with installed addons.");
  }
  return {
    game: values.get("--game") ? path.resolve(values.get("--game")!) : undefined,
    profile,
    runDir: values.get("--run-dir") ? path.resolve(values.get("--run-dir")!) : undefined,
    addonIds,
    addonsDirs,
    world,
    connectLocal,
    expectGame,
    durationSeconds,
    keepOpen,
    execute,
  };
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

async function findGameExecutable(override?: string): Promise<string> {
  const requested = override ?? process.env.REFORGER_GAME_EXE;
  if (requested) {
    const resolved = path.resolve(requested);
    if (!isFile(resolved)) throw new Error(`Game executable does not exist: ${resolved}`);
    return resolved;
  }
  for (const library of await discoverSteamLibraries()) {
    const candidate = path.join(library, "steamapps", "common", "Arma Reforger", "ArmaReforgerSteam.exe");
    if (isFile(candidate)) return candidate;
  }
  throw new Error("Arma Reforger game executable was not found. Pass --game <path> or set REFORGER_GAME_EXE.");
}

export function verifyInstalledAddons(addonIds: string[], addonsDirs: string[]): void {
  for (const directory of addonsDirs) {
    if (!isDirectory(directory)) throw new Error(`Addon directory does not exist: ${directory}`);
  }
  for (const id of addonIds) {
    let found = false;
    for (const root of addonsDirs) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const folder = path.join(root, entry.name);
        const gproj = path.join(folder, "addon.gproj");
        if (!isFile(gproj)) continue;
        const matchesFolder = entry.name.toUpperCase() === id || entry.name.toUpperCase().endsWith(`_${id}`);
        const matchesGproj = new RegExp(`\\bGUID\\s+"${id}"`, "i").test(readFileSync(gproj, "utf8"));
        if ((matchesFolder || matchesGproj) && (isFile(path.join(folder, "data.pak")) || matchesGproj)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) throw new Error(`Addon ${id} was not found in the specified --addons-dir roots. -addons does not download missing mods.`);
  }
}

export function makeClientPlan(options: ClientOptions, executable: string, runDir: string): ClientPlan {
  const profile = options.profile ?? path.join(runDir, "profile");
  const logsDir = path.join(runDir, "logs");
  const downloadDir = profile;
  const args = [
    "-profile", profile,
    "-logsDir", logsDir,
    "-addonDownloadDir", downloadDir,
    "-window", "-screenWidth", "1280", "-screenHeight", "720", "-maxFPS", "60", "-noSplash",
  ];
  if (options.addonsDirs.length > 0) args.push("-addonsDir", options.addonsDirs.join(","));
  if (options.addonIds.length > 0) args.push("-addons", options.addonIds.join(","));
  if (options.world) args.push("-world", options.world);
  if (options.connectLocal) args.push("-client", "127.0.0.1");
  return {
    executable,
    cwd: path.dirname(executable),
    profile,
    logsDir,
    downloadDir,
    args,
    durationSeconds: options.durationSeconds,
    keepOpen: options.keepOpen,
    expectGame: options.expectGame,
  };
}

function formatPowerShellCommand(plan: ClientPlan): string {
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  return `& ${[plan.executable, ...plan.args].map(quote).join(" ")}`;
}

export function classifyFatalClientLog(logText: string, connectLocal: boolean): string | undefined {
  for (const line of logText.split(/\r?\n/)) {
    if (/\bENGINE\s+\(E\):\s+Unable to initialize the game\b/i.test(line)) {
      return "Unable to initialize the game";
    }
    if (!connectLocal) continue;
    if (/\bRPL\s+\(E\):\s+ClientImpl event:\s+handshake timeout\b/i.test(line)) {
      return "RPL handshake timeout";
    }
    if (/\bNETWORK\s+\(E\):\s+Unable to connect as client\b/i.test(line)) {
      return "Unable to connect as client";
    }
  }
  return undefined;
}

export function enteredGameState(logText: string): boolean {
  return /\bSCR_BaseGameMode::OnGameStateChanged\s*=\s*GAME(?:\s|$)/m.test(logText);
}

export function requireGameState(expectGame: boolean, enteredGame: boolean, consolePath: string): void {
  if (expectGame && !enteredGame) {
    throw new Error(`Client did not reach GAME state before the run ended. Log: ${consolePath}`);
  }
}

interface ConsoleLogCursor {
  offset: number;
  tail: string;
}

interface ClientLogEvents {
  fatal?: string;
  enteredGame: boolean;
  truncated: boolean;
}

async function readClientLog(consolePath: string, cursor: ConsoleLogCursor, connectLocal: boolean): Promise<ClientLogEvents> {
  const events: ClientLogEvents = { enteredGame: false, truncated: false };
  let file;
  try {
    file = await open(consolePath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return events;
    throw error;
  }
  try {
    const size = (await file.stat()).size;
    if (size < cursor.offset) {
      cursor.offset = 0;
      cursor.tail = "";
      events.truncated = true;
    }
    while (cursor.offset < size) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - cursor.offset));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, cursor.offset);
      if (bytesRead === 0) break;
      const text = cursor.tail + buffer.subarray(0, bytesRead).toString("utf8");
      cursor.offset += bytesRead;
      cursor.tail = text.slice(-256);
      const fatal = classifyFatalClientLog(text, connectLocal);
      if (fatal) {
        events.fatal = fatal;
        return events;
      }
      if (enteredGameState(text)) events.enteredGame = true;
    }
    return events;
  } finally {
    await file.close();
  }
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

export function clientTimeLimitReached(keepOpen: boolean, deadline: number, now: number): boolean {
  return !keepOpen && now >= deadline;
}

async function executeClient(plan: ClientPlan): Promise<number> {
  await Promise.all([
    mkdir(plan.profile, { recursive: true }),
    mkdir(plan.logsDir, { recursive: true }),
    mkdir(plan.downloadDir, { recursive: true }),
  ]);
  const child = spawn(plan.executable, plan.args, { cwd: plan.cwd, stdio: "ignore", windowsHide: false });
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  const deadline = Date.now() + plan.durationSeconds * 1_000;
  const consolePath = path.join(plan.logsDir, "console.log");
  const cursor: ConsoleLogCursor = { offset: 0, tail: "" };
  const connectLocal = plan.args.includes("-client");
  let gameStateSeen = false;
  const checkClientLog = async (): Promise<void> => {
    const events = await readClientLog(consolePath, cursor, connectLocal);
    if (events.truncated) gameStateSeen = false;
    if (events.fatal) throw new Error(`Client startup failed: ${events.fatal}. Log: ${consolePath}`);
    if (events.enteredGame) gameStateSeen = true;
  };
  try {
    process.stdout.write(plan.keepOpen
      ? `Client started without a time limit. Press Ctrl+C to stop it. Logs: ${plan.logsDir}\n`
      : `Client started for up to ${plan.durationSeconds} seconds. Logs: ${plan.logsDir}\n`);
    while (!clientTimeLimitReached(plan.keepOpen, deadline, Date.now())) {
      if (spawnError) throw spawnError;
      if (interrupted) {
        process.stdout.write("Interrupted; stopping client.\n");
        return 130;
      }
      await checkClientLog();
      if (child.exitCode !== null || child.signalCode !== null) {
        if (child.exitCode === 0) {
          requireGameState(plan.expectGame, gameStateSeen, consolePath);
          process.stdout.write(`Client closed. Logs: ${plan.logsDir}\n`);
          return 0;
        }
        throw new Error(`Client exited with ${child.exitCode ?? child.signalCode}. Logs: ${plan.logsDir}`);
      }
      await delay(500);
    }
    await checkClientLog();
    requireGameState(plan.expectGame, gameStateSeen, consolePath);
    process.stdout.write(`Client reached its ${plan.durationSeconds}-second time limit; stopping game. ${plan.expectGame ? "GAME state was observed." : "Connection status is not inferred."} Log: ${consolePath}\n`);
    return 0;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    await stopChild(child);
  }
}

export async function runClientCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseClientArgs(argv);
  const roots = [...options.addonsDirs];
  if (options.profile && isDirectory(path.join(options.profile, "addons"))) {
    roots.push(path.join(options.profile, "addons"));
  }
  verifyInstalledAddons(options.addonIds, roots);
  const executable = await findGameExecutable(options.game);
  const runName = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${process.pid}`;
  const runDir = options.runDir ?? path.resolve(".cache", "client", "runs", runName);
  if (existsSync(runDir) && !isDirectory(runDir)) throw new Error(`Run path is not a directory: ${runDir}`);
  if (existsSync(path.join(runDir, "logs", "console.log"))) {
    throw new Error(`Run log already exists; choose a fresh --run-dir: ${path.join(runDir, "logs", "console.log")}`);
  }
  const plan = makeClientPlan(options, executable, runDir);
  if (existsSync(plan.profile) && !isDirectory(plan.profile)) throw new Error(`Profile path is not a directory: ${plan.profile}`);
  process.stdout.write(`Working directory: ${plan.cwd}\nProfile: ${plan.profile}\nLogs: ${plan.logsDir}\nDownloads: ${plan.downloadDir}\n`);
  process.stdout.write(`Command: ${formatPowerShellCommand(plan)}\n`);
  if (plan.expectGame) process.stdout.write("Success requires a GAME state transition in this run's console.log.\n");
  if (!options.execute) {
    process.stdout.write("Dry run only. Add --execute to start the client.\n");
    return 0;
  }
  return executeClient(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runClientCli().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
