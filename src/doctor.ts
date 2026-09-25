import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ReforgerAgentConfig } from "./config.js";
import { getRoots, type RootEntry, type RootKind } from "./fs-utils.js";

type ExecutableKind = "game" | "workbench" | "server";

export interface ExecutableLocation {
  path?: string;
  source?: "steam" | "override";
  invalidOverride?: boolean;
}

export interface WorkshopModStatus {
  id: string;
  folders: Array<{ path: string; packaged: boolean }>;
}

export interface DoctorReport {
  roots: Array<RootEntry & { exists: boolean }>;
  steamLibraries: string[];
  executables: Record<ExecutableKind, ExecutableLocation>;
  mods: WorkshopModStatus[];
}

export interface DoctorOptions {
  steamRoots?: string[];
  steamLibraries?: string[];
  executableOverrides?: Partial<Record<ExecutableKind, string>>;
}

const EXECUTABLE_CANDIDATES: Record<ExecutableKind, string[]> = {
  game: [
    "Arma Reforger/ArmaReforgerSteam.exe",
    "Arma Reforger/ArmaReforgerSteamDiag.exe",
    "Arma Reforger/ArmaReforger.exe",
  ],
  workbench: [
    "Arma Reforger Tools/Workbench/ArmaReforgerWorkbenchSteamDiag.exe",
    "Arma Reforger Tools/Workbench/ArmaReforgerWorkbenchSteam.exe",
    "Arma Reforger Tools/Workbench/ArmaReforgerWorkbench.exe",
  ],
  server: [
    "Arma Reforger Server/ArmaReforgerServer.exe",
    "Arma Reforger Server/ArmaReforgerServerSteam.exe",
    "Arma Reforger/ArmaReforgerServer.exe",
    "Arma Reforger/ArmaReforgerServerSteam.exe",
  ],
};

export async function runDoctor(
  config: ReforgerAgentConfig,
  modIds: string[] = [],
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const roots = await Promise.all(
    getRoots(config, "all").map(async (root) => ({ ...root, exists: await isDirectory(root.root) })),
  );
  const steamLibraries = await discoverSteamLibraries(options);
  const overrides = options.executableOverrides ?? {
    game: process.env.REFORGER_GAME_EXE,
    workbench: process.env.REFORGER_WORKBENCH_EXE,
    server: process.env.REFORGER_SERVER_EXE,
  };
  const executables = {
    game: await findExecutable("game", steamLibraries, overrides.game),
    workbench: await findExecutable("workbench", steamLibraries, overrides.workbench),
    server: await findExecutable("server", steamLibraries, overrides.server),
  };
  const mods = await findWorkshopMods(modIds, config.modRoots);

  return { roots, steamLibraries, executables, mods };
}

export function parseSteamLibraryFolders(vdf: string): string[] {
  const paths = [...vdf.matchAll(/"path"\s*"((?:\\.|[^"\\])*)"/g)].map((match) =>
    match[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"'),
  );
  return uniquePaths(paths);
}

export async function discoverSteamLibraries(options: DoctorOptions = {}): Promise<string[]> {
  const steamRoots = options.steamRoots ?? defaultSteamRoots();
  const explicitLibraries = options.steamLibraries ?? splitPaths(process.env.REFORGER_STEAM_LIBRARIES);
  const candidates = [...steamRoots, ...explicitLibraries];

  for (const root of steamRoots) {
    try {
      const vdf = await readFile(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
      candidates.push(...parseSteamLibraryFolders(vdf));
    } catch {
      // A Steam root can be absent or have no library index.
    }
  }

  const normalized = uniquePaths(candidates);
  const existing = await Promise.all(normalized.map(async (library) => ({ library, exists: await isDirectory(library) })));
  return existing.filter((entry) => entry.exists).map((entry) => entry.library);
}

export async function findWorkshopMods(modIds: string[], modRoots: string[]): Promise<WorkshopModStatus[]> {
  const ids = [...new Set(modIds.map((id) => id.trim().toUpperCase()))];
  for (const id of ids) {
    if (!/^[0-9A-F]{16}$/.test(id)) {
      throw new Error(`Invalid Workshop mod ID: ${id}. Expected 16 hexadecimal characters.`);
    }
  }

  const statuses = ids.map((id) => ({ id, folders: [] as WorkshopModStatus["folders"] }));
  for (const root of modRoots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const folderName = entry.name.toUpperCase();
      const status = statuses.find(({ id }) => folderName === id || folderName.endsWith(`_${id}`));
      if (!status) {
        continue;
      }

      const folderPath = path.join(root, entry.name);
      status.folders.push({ path: folderPath, packaged: await isFile(path.join(folderPath, "data.pak")) });
    }
  }

  return statuses;
}

export function formatDoctorReport(report: DoctorReport): string {
  const kinds: RootKind[] = ["mod", "doc", "sample"];
  const rootsSummary = kinds.map((kind) => {
    const roots = report.roots.filter((root) => root.kind === kind);
    return `${kind} ${roots.filter((root) => root.exists).length}/${roots.length}`;
  });
  const lines = [
    `Roots: ${rootsSummary.join(", ")}`,
    ...report.roots.filter((root) => !root.exists).map((root) => `Missing ${root.kind} root: ${root.root}`),
    `Steam libraries: ${report.steamLibraries.length}`,
    ...(["game", "workbench", "server"] as ExecutableKind[]).map((kind) => {
      const found = report.executables[kind];
      const label = kind === "server" ? "Dedicated server" : kind === "game" ? "Game" : "Workbench";
      if (found.invalidOverride) {
        return `${label}: override path missing`;
      }
      return `${label}: ${found.path ?? "not found"}`;
    }),
    ...report.mods.map((mod) => {
      const packaged = mod.folders.filter((folder) => folder.packaged).length;
      if (packaged > 0) {
        return `Workshop ${mod.id}: installed (${packaged} packaged folder${packaged === 1 ? "" : "s"})`;
      }
      return `Workshop ${mod.id}: ${mod.folders.length ? "folder present, data.pak missing" : "not found"}`;
    }),
  ];
  return lines.join("\n");
}

async function findExecutable(
  kind: ExecutableKind,
  steamLibraries: string[],
  override?: string,
): Promise<ExecutableLocation> {
  if (override?.trim()) {
    const candidate = path.resolve(override.trim());
    return (await isFile(candidate))
      ? { path: candidate, source: "override" }
      : { invalidOverride: true };
  }

  for (const library of steamLibraries) {
    if (kind === "server") {
      const automationInstall = path.join(library, "reforger-automation", "server", "ArmaReforgerServer.exe");
      if (await isFile(automationInstall)) {
        return { path: automationInstall, source: "steam" };
      }
    }
    for (const relativePath of EXECUTABLE_CANDIDATES[kind]) {
      const candidate = path.join(library, "steamapps", "common", ...relativePath.split("/"));
      if (await isFile(candidate)) {
        return { path: candidate, source: "steam" };
      }
    }
  }
  return {};
}

function defaultSteamRoots(): string[] {
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const programFiles = process.env.ProgramFiles;
  return uniquePaths([
    process.env.REFORGER_STEAM_ROOT,
    programFilesX86 && path.join(programFilesX86, "Steam"),
    programFiles && path.join(programFiles, "Steam"),
    ...(process.platform === "win32" ? ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"] : []),
  ]);
}

function splitPaths(value?: string): string[] {
  return value?.split(path.delimiter).map((part) => part.trim()).filter(Boolean) ?? [];
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    if (!raw?.trim()) {
      continue;
    }
    const resolved = path.resolve(raw.trim());
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(resolved);
    }
  }
  return result;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}
