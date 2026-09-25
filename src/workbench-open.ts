import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type WorkbenchEditor = "resource" | "script" | "world";

export interface WorkbenchOpenOptions {
  editor: WorkbenchEditor;
  project: string;
  world?: string;
  tool?: string;
  gameAddons?: string;
  logsDir?: string;
  authorizeLocalTestScripts: boolean;
  execute: boolean;
}

export interface WorkbenchOpenPlan {
  executable: string;
  args: string[];
  logsDir: string;
}

const MODULE: Record<WorkbenchEditor, string> = {
  resource: "ResourceManager",
  script: "ScriptEditor",
  world: "WorldEditor",
};

const USAGE = `Open the existing addon in Workbench (dry run by default)

  npm run workbench:open -- [--editor resource|script|world] [--world <resource.ent>] [--project <addon.gproj>] [--tool <Workbench.exe>] [--game-addons <directory>] [--logs-dir <directory>] [--authorize-local-test-scripts] [--execute]

The default editor is Resource Manager. --world is valid only with --editor world.
Use --execute to launch the GUI. This command does not validate, pack, or publish an addon.
--authorize-local-test-scripts passes the official -scriptAuthorizeAll flag only for this Workbench process.
It allows scripted local test runs without the script authorization popup; never use it for an untrusted project.
`;

export function parseWorkbenchOpenArgs(argv: string[]): WorkbenchOpenOptions {
  const values = new Map<string, string>();
  let execute = false;
  let authorizeLocalTestScripts = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--authorize-local-test-scripts") {
      if (authorizeLocalTestScripts) throw new Error(`${flag} was provided twice.`);
      authorizeLocalTestScripts = true;
      continue;
    }
    if (flag === "--execute") {
      if (execute) throw new Error("--execute was provided twice.");
      execute = true;
      continue;
    }
    if (!["--editor", "--world", "--project", "--tool", "--game-addons", "--logs-dir"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`Expected one value for ${flag}.`);
    }
    values.set(flag, value);
  }

  const editor = values.get("--editor") ?? "resource";
  if (!(editor in MODULE)) throw new Error("--editor must be resource, script, or world.");
  const world = values.get("--world");
  if (world && editor !== "world") throw new Error("--world requires --editor world.");
  if (world && !world.toLowerCase().endsWith(".ent")) throw new Error("--world must name a .ent resource.");

  const defaultProject = path.join(os.homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "addons", "New Enfusion Project", "addon.gproj");
  const project = values.get("--project") ?? process.env.REFORGER_ADDON_PROJECT ?? defaultProject;
  if (path.extname(project).toLowerCase() !== ".gproj") throw new Error("--project must name an addon.gproj file.");

  return {
    editor: editor as WorkbenchEditor,
    project: path.resolve(project),
    world,
    tool: values.get("--tool") ? path.resolve(values.get("--tool")!) : undefined,
    gameAddons: values.get("--game-addons") ? path.resolve(values.get("--game-addons")!) : undefined,
    logsDir: values.get("--logs-dir") ? path.resolve(values.get("--logs-dir")!) : undefined,
    authorizeLocalTestScripts,
    execute,
  };
}

export function makeWorkbenchOpenPlan(options: WorkbenchOpenOptions, executable: string, gameAddonsDir: string, logsDir: string): WorkbenchOpenPlan {
  return {
    executable,
    logsDir,
    args: [
      "-gproj", options.project,
      "-addonsDir", gameAddonsDir,
      "-logsDir", logsDir,
      ...(options.authorizeLocalTestScripts ? ["-scriptAuthorizeAll"] : []),
      `-wbModule=${MODULE[options.editor]}`, "-run",
      ...(options.world ? ["-load", options.world] : []),
    ],
  };
}

function existingPath(requested: string, kind: "file" | "directory", description: string): string {
  const resolved = path.resolve(requested);
  if (!existsSync(resolved) || (kind === "file" ? !statSync(resolved).isFile() : !statSync(resolved).isDirectory())) {
    throw new Error(`${description} does not exist: ${resolved}`);
  }
  return resolved;
}

function firstExisting(candidates: Array<string | undefined>, kind: "file" | "directory", description: string): string {
  const found = candidates.find((candidate) => candidate && existsSync(candidate) && (kind === "file" ? statSync(candidate).isFile() : statSync(candidate).isDirectory()));
  if (!found) throw new Error(`${description} was not found. Pass the corresponding path option or set its REFORGER_* environment variable.`);
  return path.resolve(found);
}

function findWorkbench(explicit?: string): string {
  const requested = explicit ?? process.env.REFORGER_WORKBENCH_EXE;
  if (requested) return existingPath(requested, "file", "Workbench executable");
  const subpath = path.join("steamapps", "common", "Arma Reforger Tools", "Workbench", "ArmaReforgerWorkbenchSteamDiag.exe");
  return firstExisting([
    path.join("D:\\SteamLibrary", subpath),
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "Steam", subpath) : undefined,
    path.join("C:\\Program Files (x86)", "Steam", subpath),
  ], "file", "Workbench executable");
}

function findGameAddons(explicit?: string): string {
  const requested = explicit ?? process.env.REFORGER_GAME_ADDONS_DIR;
  if (requested) return existingPath(requested, "directory", "Game addons directory");
  const subpath = path.join("steamapps", "common", "Arma Reforger", "addons");
  return firstExisting([
    path.join("D:\\SteamLibrary", subpath),
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "Steam", subpath) : undefined,
    path.join("C:\\Program Files (x86)", "Steam", subpath),
  ], "directory", "Game addons directory");
}

function powershellCommand(plan: WorkbenchOpenPlan): string {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return `& ${[plan.executable, ...plan.args].map(quote).join(" ")}`;
}

export async function runWorkbenchOpenCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }

  const options = parseWorkbenchOpenArgs(argv);
  existingPath(options.project, "file", "Project file");
  const tool = findWorkbench(options.tool);
  const gameAddonsDir = findGameAddons(options.gameAddons);
  const runName = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${process.pid}`;
  const logsDir = options.logsDir ?? path.resolve(".cache", "workbench-gui-runs", runName);
  const plan = makeWorkbenchOpenPlan(options, tool, gameAddonsDir, logsDir);

  process.stdout.write(`${powershellCommand(plan)}\n`);
  if (!options.execute) {
    process.stdout.write("Dry run only. Add --execute to open Workbench.\n");
    return 0;
  }

  mkdirSync(plan.logsDir, { recursive: true });
  const child = spawn(plan.executable, plan.args, {
    cwd: path.dirname(plan.executable),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  process.stdout.write(`Workbench launched (PID ${child.pid}). Logs: ${plan.logsDir}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runWorkbenchOpenCli().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
