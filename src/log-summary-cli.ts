import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = `Summarize one Arma Reforger client or server console.log (read-only)

  npx tsx src/log-summary-cli.ts --log <console.log> [--json]

The latest mission and latest Loaded addons block are reported. A Raven task claim,
bootstrap, or log-reported transfer is not independent proof of a delivery.
`;

export interface LogSummaryOptions {
  logPath: string;
  json: boolean;
}

export interface LogEvidence {
  line: number;
  text: string;
}

export interface LoadedAddon {
  line: number;
  guid: string;
  project: string;
}

export interface ReforgerLogSummary {
  logPath: string;
  mission?: LogEvidence;
  gameTransition?: LogEvidence;
  gameReachedForLatestMission: boolean;
  loadedAddons: LoadedAddon[];
  raven: {
    runtimeStarted?: LogEvidence;
    bootstrapComplete?: LogEvidence;
    logisticsReady?: LogEvidence;
  };
  supplyRuns: {
    total: number;
    claimed: number;
    blocked: number;
    reportedTransfers: number;
    recentEvents: LogEvidence[];
  };
  joinOrStartupFailureCount: number;
  joinOrStartupFailures: Array<LogEvidence & { kind: string }>;
  deliveryVerification: "not_established_by_log";
}

export function parseLogSummaryArgs(argv: string[]): LogSummaryOptions {
  let logPath: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") {
      if (json) throw new Error("--json was provided twice.");
      json = true;
      continue;
    }
    if (flag !== "--log") throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    if (logPath) throw new Error("--log was provided twice.");
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error("Expected a path after --log.");
    logPath = path.resolve(value);
  }
  if (!logPath) throw new Error(`Pass an explicit --log <console.log> path.\n\n${USAGE}`);
  return { logPath, json };
}

function evidence(line: number, text: string): LogEvidence {
  return { line, text: text.trim() };
}

function failureKind(line: string): string | undefined {
  if (/\bRPL\s+\(E\):.*\bhandshake timeout\b/i.test(line)) return "RPL handshake timeout";
  if (/\bNETWORK\s+\(E\):.*\bUnable to connect as client\b/i.test(line)) return "Unable to connect as client";
  if (/\bENGINE\s+\(E\):.*\bUnable to initialize the game\b/i.test(line)) return "Unable to initialize the game";
  if (/\bRplAuthBackend::OnFailure\b.*\breason=3\b/i.test(line)) return "RPL authentication failure (reason 3)";
  return undefined;
}

export function summarizeReforgerLog(logText: string, logPath: string): ReforgerLogSummary {
  const summary: ReforgerLogSummary = {
    logPath: path.resolve(logPath),
    gameReachedForLatestMission: false,
    loadedAddons: [],
    raven: {},
    supplyRuns: { total: 0, claimed: 0, blocked: 0, reportedTransfers: 0, recentEvents: [] },
    joinOrStartupFailureCount: 0,
    joinOrStartupFailures: [],
    deliveryVerification: "not_established_by_log",
  };
  let inLoadedAddons = false;
  for (const [index, line] of logText.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (/\bENGINE\s+:\s+Loaded addons:\s*$/i.test(line)) {
      summary.loadedAddons = [];
      inLoadedAddons = true;
      continue;
    }
    if (inLoadedAddons) {
      const addon = /\bgproj:\s+'([^']+)'\s+guid:\s+'([0-9a-f]{16})'/i.exec(line);
      if (addon) {
        summary.loadedAddons.push({ line: lineNumber, project: addon[1], guid: addon[2].toUpperCase() });
        continue;
      }
      if (line.trim()) inLoadedAddons = false;
    }

    const mission = /\bStarting new playthrough\b.*?\bfor mission '([^']+)'/i.exec(line);
    if (mission) {
      summary.mission = evidence(lineNumber, mission[1]);
      summary.gameTransition = undefined;
      summary.gameReachedForLatestMission = false;
      summary.raven = {};
      summary.supplyRuns = { total: 0, claimed: 0, blocked: 0, reportedTransfers: 0, recentEvents: [] };
    }
    if (/\bSCR_BaseGameMode::OnGameStateChanged\s*=\s*GAME(?:\s|$)/.test(line)) {
      summary.gameTransition = evidence(lineNumber, line);
      summary.gameReachedForLatestMission = true;
    }

    const failure = failureKind(line);
    if (failure) {
      summary.joinOrStartupFailureCount += 1;
      summary.joinOrStartupFailures.push({ ...evidence(lineNumber, line), kind: failure });
      if (summary.joinOrStartupFailures.length > 8) summary.joinOrStartupFailures.shift();
    }

    if (!/\[RavenAI[^\]]*\]/i.test(line)) continue;
    if (/\bAUTO RUNTIME STARTED\b/i.test(line)) summary.raven.runtimeStarted = evidence(lineNumber, line);
    if (/\bAUTO BOOTSTRAP COMPLETE\b/i.test(line)) summary.raven.bootstrapComplete = evidence(lineNumber, line);
    if (/\bFACTION LOGISTICS READY\b/i.test(line)) summary.raven.logisticsReady = evidence(lineNumber, line);
    if (!/\bSUPPLY_RUN\b/i.test(line)) continue;
    summary.supplyRuns.total += 1;
    if (/\bCLAIMED\b/i.test(line)) summary.supplyRuns.claimed += 1;
    if (/\bBLOCKED\b/i.test(line)) summary.supplyRuns.blocked += 1;
    if (/\b(?:TRANSFERRED|DELIVERED)\b/i.test(line)) summary.supplyRuns.reportedTransfers += 1;
    summary.supplyRuns.recentEvents.push(evidence(lineNumber, line));
    if (summary.supplyRuns.recentEvents.length > 8) summary.supplyRuns.recentEvents.shift();
  }
  return summary;
}

function addonName(project: string): string {
  const normalized = project.replaceAll("/", "\\");
  return path.win32.basename(path.win32.dirname(normalized));
}

function at(event?: LogEvidence): string {
  return event ? `line ${event.line}` : "not observed";
}

export function formatLogSummary(summary: ReforgerLogSummary): string {
  const lines = [
    `Log: ${summary.logPath}`,
    `Latest mission: ${summary.mission ? `${summary.mission.text} (line ${summary.mission.line})` : "not observed"}`,
    `GAME for latest mission: ${summary.gameReachedForLatestMission ? at(summary.gameTransition) : "not observed"}`,
    `Loaded addons (latest block): ${summary.loadedAddons.length ? summary.loadedAddons.map((addon) => `${addon.guid} ${addonName(addon.project)} (line ${addon.line})`).join(", ") : "none observed"}`,
    `Raven runtime: ${at(summary.raven.runtimeStarted)}; bootstrap: ${at(summary.raven.bootstrapComplete)}; logistics ready: ${at(summary.raven.logisticsReady)}`,
    `Raven SUPPLY_RUN events for latest mission: ${summary.supplyRuns.total} total, ${summary.supplyRuns.claimed} claimed, ${summary.supplyRuns.blocked} blocked, ${summary.supplyRuns.reportedTransfers} log-reported transfers`,
  ];
  for (const event of summary.supplyRuns.recentEvents) lines.push(`  line ${event.line}: ${event.text}`);
  lines.push(`Join/startup failures across log: ${summary.joinOrStartupFailureCount}${summary.joinOrStartupFailureCount ? `; recent: ${summary.joinOrStartupFailures.map((event) => `${event.kind} (line ${event.line})`).join(", ")}` : ""}`);
  lines.push("Delivery: not verified by this log. Check player-facing actions and source/destination resource counts.");
  return `${lines.join("\n")}\n`;
}

export function runLogSummaryCli(argv = process.argv.slice(2)): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseLogSummaryArgs(argv);
  let logText: string;
  try {
    if (!statSync(options.logPath).isFile()) throw new Error("Path is not a file");
    logText = readFileSync(options.logPath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read Reforger log ${options.logPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const summary = summarizeReforgerLog(logText, options.logPath);
  process.stdout.write(options.json ? `${JSON.stringify(summary, null, 2)}\n` : formatLogSummary(summary));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = runLogSummaryCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
