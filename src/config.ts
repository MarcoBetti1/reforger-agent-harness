import { access, readFile } from "node:fs/promises";
import path from "node:path";

export interface ReforgerAgentConfig {
  modRoots: string[];
  docRoots: string[];
  sampleRoots: string[];
}

export interface LoadedConfig {
  path: string;
  config: ReforgerAgentConfig;
}

const DEFAULT_CONFIG_FILE = "reforger-agent.config.json";

export function resolveConfigPath(cwd = process.cwd()): string {
  const configuredPath = process.env.REFORGER_AGENT_CONFIG ?? DEFAULT_CONFIG_FILE;
  return path.resolve(cwd, configuredPath);
}

export async function loadConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  const configPath = resolveConfigPath(cwd);
  const configDir = path.dirname(configPath);

  try {
    await access(configPath);
  } catch {
    throw new Error(
      `Config file not found at ${configPath}. Create it from reforger-agent.config.example.json or set REFORGER_AGENT_CONFIG.`,
    );
  }

  const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<ReforgerAgentConfig>;

  return {
    path: configPath,
    config: {
      modRoots: normalizeRoots(raw.modRoots, configDir),
      docRoots: normalizeRoots(raw.docRoots, configDir),
      sampleRoots: normalizeRoots(raw.sampleRoots, configDir),
    },
  };
}

function normalizeRoots(value: unknown, configDir: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Config roots must be arrays of strings.");
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => path.resolve(configDir, entry.trim()));

  return [...new Set(normalized)];
}
