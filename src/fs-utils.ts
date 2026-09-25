import { access, readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

import type { ReforgerAgentConfig } from "./config.js";

export type RootKind = "mod" | "doc" | "sample";
export type RootFilter = RootKind | "all";

export interface RootEntry {
  kind: RootKind;
  root: string;
}

export interface TextHit {
  kind: RootKind;
  path: string;
  line: number;
  snippet: string;
}

const TEXT_EXTENSIONS = new Set([
  ".acp",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".c",
  ".et",
  ".gproj",
  ".htm",
  ".html",
  ".json",
  ".js",
  ".layout",
  ".md",
  ".meta",
  ".txt",
  ".st",
  ".xml",
  ".yml",
  ".yaml",
]);

const DEFAULT_IGNORES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
];

export function getRoots(config: ReforgerAgentConfig, rootType: RootFilter): RootEntry[] {
  const roots: RootEntry[] = [
    ...config.modRoots.map((root) => ({ kind: "mod" as const, root })),
    ...config.docRoots.map((root) => ({ kind: "doc" as const, root })),
    ...config.sampleRoots.map((root) => ({ kind: "sample" as const, root })),
  ];

  if (rootType === "all") {
    return roots;
  }

  return roots.filter((entry) => entry.kind === rootType);
}

export async function listFiles(
  roots: RootEntry[],
  pattern = "**/*",
  limit = 100,
): Promise<Array<{ kind: RootKind; path: string }>> {
  const results: Array<{ kind: RootKind; path: string }> = [];

  for (const root of roots) {
    if (results.length >= limit) {
      break;
    }

    const matches = await fg(pattern, {
      cwd: root.root,
      absolute: true,
      onlyFiles: true,
      ignore: DEFAULT_IGNORES,
      unique: true,
    });

    for (const match of matches) {
      results.push({ kind: root.kind, path: path.resolve(match) });
      if (results.length >= limit) {
        break;
      }
    }
  }

  return results;
}

export async function searchText(
  query: string,
  roots: RootEntry[],
  limit = 20,
): Promise<TextHit[]> {
  const normalizedQuery = query.toLowerCase();
  const files = await listFiles(roots, "**/*", 3000);
  const hits: TextHit[] = [];

  for (const file of files) {
    if (hits.length >= limit || !isTextFile(file.path)) {
      continue;
    }

    const content = await safeReadText(file.path, 200_000);
    const lineMatch = content
      .split(/\r?\n/)
      .findIndex((line) => line.toLowerCase().includes(normalizedQuery));

    if (lineMatch >= 0) {
      const lines = content.split(/\r?\n/);
      hits.push({
        kind: file.kind,
        path: file.path,
        line: lineMatch + 1,
        snippet: lines[lineMatch].trim(),
      });
    }
  }

  return hits;
}

export async function resolveAccessiblePath(
  userPath: string,
  roots: RootEntry[],
): Promise<string | null> {
  if (path.isAbsolute(userPath)) {
    return (await isAccessibleUnderRoots(userPath, roots)) ? path.resolve(userPath) : null;
  }

  for (const root of roots) {
    const candidate = path.resolve(root.root, userPath);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function safeReadText(filePath: string, maxCharacters = 12_000): Promise<string> {
  const raw = await readFile(filePath, "utf8");
  return raw.length > maxCharacters ? `${raw.slice(0, maxCharacters)}\n...<truncated>` : raw;
}

export function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function looksLikeReforgerSource(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.endsWith(".gproj") ||
    normalized.endsWith(".conf") ||
    normalized.endsWith(".st") ||
    normalized.endsWith(".et") ||
    normalized.endsWith(".c") ||
    normalized.includes("/Scripts/GameCode/") ||
    normalized.includes("/Scripts/WorkbenchGame/")
  );
}

async function isAccessibleUnderRoots(filePath: string, roots: RootEntry[]): Promise<boolean> {
  if (!(await exists(filePath))) {
    return false;
  }

  const resolved = path.resolve(filePath);
  return roots.some((root) => {
    const base = path.resolve(root.root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
