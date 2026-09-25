import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Action = "validate" | "pack";

export interface WorkbenchOptions {
  action: Action;
  project: string;
  output?: string;
  tool?: string;
  gameAddons?: string;
  configuration: "PC" | "ALL";
  logsDir?: string;
  execute: boolean;
}

export interface WorkbenchStep {
  name: "validate" | "pack";
  executable: string;
  args: string[];
  logsDir: string;
}

const USAGE = `Workbench helper (dry run by default)

  npm run workbench -- validate --project <addon.gproj> [--configuration PC|ALL] [--tool <Workbench.exe>] [--game-addons <directory>] [--logs-dir <directory>] [--execute]
  npm run workbench -- pack --project <addon.gproj> --output <directory> [--configuration PC|ALL] [--tool <Workbench.exe>] [--game-addons <directory>] [--logs-dir <directory>] [--execute]

PC is requested by default. In the installed Workbench build, a live PC run still checked all platform configurations. Pack runs validation first as a separate process. No command publishes a mod.
`;

export function parseWorkbenchArgs(argv: string[]): WorkbenchOptions {
  const [action, ...rest] = argv;
  if (action !== "validate" && action !== "pack") {
    throw new Error(USAGE);
  }

  const values = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === "--execute") {
      if (execute) throw new Error("--execute was provided twice.");
      execute = true;
      continue;
    }
    if (!["--project", "--output", "--configuration", "--tool", "--game-addons", "--logs-dir"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    }
    const value = rest[++i];
    if (!value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`Expected one value for ${flag}.`);
    }
    values.set(flag, value);
  }

  const project = values.get("--project");
  const output = values.get("--output");
  if (!project || path.extname(project).toLowerCase() !== ".gproj") {
    throw new Error("--project must name an existing .gproj file.");
  }
  if (action === "pack" && !output) {
    throw new Error("pack requires --output <directory>.");
  }
  if (action === "validate" && output) {
    throw new Error("--output is only valid for pack.");
  }
  const configuration = (values.get("--configuration") ?? "PC").toUpperCase();
  if (configuration !== "PC" && configuration !== "ALL") {
    throw new Error("--configuration must be PC or ALL.");
  }

  return {
    action,
    project: path.resolve(project),
    output: output ? path.resolve(output) : undefined,
    tool: values.get("--tool") ? path.resolve(values.get("--tool")!) : undefined,
    gameAddons: values.get("--game-addons") ? path.resolve(values.get("--game-addons")!) : undefined,
    configuration,
    logsDir: values.get("--logs-dir") ? path.resolve(values.get("--logs-dir")!) : undefined,
    execute,
  };
}

export function makeWorkbenchPlan(options: WorkbenchOptions, executable: string, baseLogsDir: string, gameAddonsDir: string): WorkbenchStep[] {
  const common = ["-gproj", options.project, "-addonsDir", gameAddonsDir];
  const validateLogs = path.join(baseLogsDir, "validate");
  const steps: WorkbenchStep[] = [{
    name: "validate",
    executable,
    logsDir: validateLogs,
    args: [...common, "-logsDir", validateLogs, "-wbSilent", "-wbModule=ScriptEditor", "-validate", ...(options.configuration === "PC" ? ["PC"] : [])],
  }];

  if (options.action === "pack") {
    if (!options.output) throw new Error("Pack output is missing.");
    const packLogs = path.join(baseLogsDir, "pack");
    steps.push({
      name: "pack",
      executable,
      logsDir: packLogs,
      args: [...common, "-logsDir", packLogs, "-wbModule=ResourceManager", "-packAddon", "-packAddonDir", options.output],
    });
  }
  return steps;
}

function findGameAddons(explicitPath?: string): string {
  const requested = explicitPath ?? process.env.REFORGER_GAME_ADDONS_DIR;
  if (requested) {
    if (!existsSync(requested) || !statSync(requested).isDirectory()) {
      throw new Error(`Game addons directory does not exist: ${requested}`);
    }
    return path.resolve(requested);
  }

  const subpath = path.join("steamapps", "common", "Arma Reforger", "addons");
  const candidates = [
    path.join("D:\\SteamLibrary", subpath),
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "Steam", subpath) : undefined,
    path.join("C:\\Program Files (x86)", "Steam", subpath),
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate) && statSync(candidate).isDirectory());
  if (!found) throw new Error("Game addons directory was not found. Pass --game-addons <directory> or set REFORGER_GAME_ADDONS_DIR.");
  return path.resolve(found);
}

function findWorkbench(explicitPath?: string): string {
  const requested = explicitPath ?? process.env.REFORGER_WORKBENCH_EXE;
  if (requested) {
    if (!existsSync(requested) || !statSync(requested).isFile()) {
      throw new Error(`Workbench executable does not exist: ${requested}`);
    }
    return path.resolve(requested);
  }

  const steamSubpath = path.join("steamapps", "common", "Arma Reforger Tools", "Workbench", "ArmaReforgerWorkbenchSteamDiag.exe");
  const candidates = [
    path.join("D:\\SteamLibrary", steamSubpath),
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "Steam", steamSubpath) : undefined,
    path.join("C:\\Program Files (x86)", "Steam", steamSubpath),
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate) && statSync(candidate).isFile());
  if (!found) throw new Error("Workbench executable was not found. Pass --tool <path> or set REFORGER_WORKBENCH_EXE.");
  return path.resolve(found);
}

function powershellCommand(step: WorkbenchStep): string {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return `& ${[step.executable, ...step.args].map(quote).join(" ")}`;
}

/** Workbench has returned zero even when packing failed, so verify both outcomes on disk. */
export function verifyPackResult(outputDir: string, logsDir: string, startedAtMs: number): string[] {
  const problems: string[] = [];
  const consoleLog = path.join(logsDir, "console.log");
  const dataPak = path.join(outputDir, "data.pak");
  // Leave a small margin for filesystem timestamp precision, while rejecting older artifacts.
  const earliestWriteMs = startedAtMs - 1000;

  if (!existsSync(consoleLog) || !statSync(consoleLog).isFile()) {
    problems.push(`Pack log is missing: ${consoleLog}`);
  } else {
    if (statSync(consoleLog).mtimeMs < earliestWriteMs) {
      problems.push(`Pack log was not updated by this run: ${consoleLog}`);
    } else {
      const log = readFileSync(consoleLog, "utf8");
      if (!/^.*\bRESOURCES\s*:\s*Packaging project successful\s*$/m.test(log)) {
        problems.push(`Pack log does not report "Packaging project successful": ${consoleLog}`);
      }
    }
  }

  if (!existsSync(dataPak) || !statSync(dataPak).isFile()) {
    problems.push(`Packed data.pak is missing: ${dataPak}`);
  } else {
    const pak = statSync(dataPak);
    if (pak.size === 0) problems.push(`Packed data.pak is empty: ${dataPak}`);
    if (pak.mtimeMs < earliestWriteMs) problems.push(`Packed data.pak was not updated by this run: ${dataPak}`);
  }

  return problems;
}

export function runWorkbenchCli(argv = process.argv.slice(2)): number {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  const options = parseWorkbenchArgs(argv);
  if (!existsSync(options.project) || !statSync(options.project).isFile()) {
    throw new Error(`Project file does not exist: ${options.project}`);
  }
  if (options.output) {
    const projectDir = path.dirname(options.project);
    const relative = path.relative(projectDir, options.output);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new Error("Pack output must be outside the project directory.");
    }
  }

  const tool = findWorkbench(options.tool);
  const gameAddonsDir = findGameAddons(options.gameAddons);
  const runName = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const logsDir = options.logsDir ?? path.resolve(".cache", "workbench-runs", runName);
  const plan = makeWorkbenchPlan(options, tool, logsDir, gameAddonsDir);

  for (const step of plan) {
    process.stdout.write(`${step.name}: ${powershellCommand(step)}\n`);
  }
  if (!options.execute) {
    process.stdout.write("Dry run only. Add --execute to run these commands.\n");
    return 0;
  }

  for (const step of plan) {
    mkdirSync(step.logsDir, { recursive: true });
    if (step.name === "pack" && options.output) mkdirSync(options.output, { recursive: true });
    const startedAtMs = Date.now();
    const result = spawnSync(step.executable, step.args, { cwd: path.dirname(step.executable), stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`${step.name} was terminated by ${result.signal}. Logs: ${step.logsDir}`);
    if (result.status !== 0) {
      process.stderr.write(`${step.name} failed with exit code ${result.status}. Logs: ${step.logsDir}\n`);
      return result.status ?? 1;
    }
    if (step.name === "pack" && options.output) {
      const problems = verifyPackResult(options.output, step.logsDir, startedAtMs);
      if (problems.length > 0) {
        process.stderr.write(`Pack verification failed despite Workbench exit code 0:\n${problems.join("\n")}\n`);
        return 1;
      }
    }
    process.stdout.write(`${step.name} completed. Logs: ${step.logsDir}\n`);
  }
  if (options.action === "pack") {
    process.stdout.write(`Verified Workbench packaging success and fresh data.pak: ${path.join(options.output!, "data.pak")}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = runWorkbenchCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
