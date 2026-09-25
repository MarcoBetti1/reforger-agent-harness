import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig, resolveConfigPath } from "./config.js";
import { discoverSteamLibraries } from "./doctor.js";

export interface KnowledgePreparationResult {
  cacheRoot: string;
  extractedApiRoots: string[];
  savedWebPages: string[];
  manifestPath: string;
}

interface WebKnowledgeSource {
  category: string;
  title: string;
  url: string;
}

const API_DOCS = [
  { names: ["ArmaReforgerScriptAPIPublic"] },
  { names: ["EnfusionScriptAPI", "EnfusionScriptAPIPublic"] },
];

export interface KnowledgePreparationOptions {
  docRoots?: string[];
  steamLibraries?: string[];
  webSources?: WebKnowledgeSource[];
  fetchPage?: typeof fetch;
}

const WEB_SOURCES: WebKnowledgeSource[] = [
  {
    category: "setup",
    title: "Mod Project Setup",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AMod_Project_Setup?useskin=vector",
  },
  {
    category: "setup",
    title: "Directory Structure",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3ADirectory_Structure?useskin=vector",
  },
  {
    category: "setup",
    title: "File Types",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AFile_Types?useskin=vector",
  },
  {
    category: "workflow",
    title: "Data Modding Basics",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AData_Modding_Basics?useskin=vector",
  },
  {
    category: "workflow",
    title: "Asset Browser Mod Integration",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AAsset_Browser_Mod_Integration?useskin=vector",
  },
  {
    category: "workflow",
    title: "Prefabs Basics",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3APrefabs_Basics?useskin=vector",
  },
  {
    category: "workflow",
    title: "Entity Catalog",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AEntity_Catalog?useskin=vector",
  },
  {
    category: "workflow",
    title: "Scripting Example",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AScripting_Example?useskin=vector",
  },
  {
    category: "tools",
    title: "Workbench Plugin",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AWorkbench_Plugin?useskin=vector",
  },
  {
    category: "tools",
    title: "Workbench Plugin Tutorial",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AWorkbench_Plugin_Tutorial?useskin=vector",
  },
  {
    category: "tools",
    title: "Startup Parameters",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AStartup_Parameters?useskin=vector",
  },
  {
    category: "publishing",
    title: "Mod Publishing Process",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AMod_Publishing_Process?useskin=vector",
  },
  {
    category: "assets",
    title: "Vehicle Creation",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AVehicle_Creation?useskin=vector",
  },
  {
    category: "assets",
    title: "Weapon Modding",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AWeapon_Modding?useskin=vector",
  },
  {
    category: "assets",
    title: "Weapon Creation Asset Preparation",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AWeapon_Creation/Asset_Preparation?useskin=vector",
  },
  {
    category: "assets",
    title: "Weapon Optic Creation",
    url: "https://community.bohemia.net/wiki/Arma_Reforger%3AWeapon_Optic_Creation?useskin=vector",
  },
  {
    category: "assets",
    title: "Batch Texture Processor Plugin",
    url:
      "https://community.bohemia.net/wiki/Arma_Reforger%3AResource_Manager%3A_Batch_Texture_Processor_Plugin?useskin=vector",
  },
];

export async function prepareKnowledge(
  cwd = process.cwd(),
  force = false,
  options: KnowledgePreparationOptions = {},
): Promise<KnowledgePreparationResult> {
  const cacheRoot = path.resolve(cwd, ".cache", "knowledge");
  const offlineApiRoot = path.join(cacheRoot, "offline-api");
  const webRoot = path.join(cacheRoot, "official-web");

  await mkdir(webRoot, { recursive: true });

  const configuredRoots = options.docRoots ?? (await loadConfiguredDocRoots(cwd));
  const steamLibraries = options.steamLibraries ?? (await discoverSteamLibraries());
  const toolsDocRoots = steamLibraries.map((library) =>
    path.join(library, "steamapps", "common", "Arma Reforger Tools", "Workbench", "docs"),
  );
  const liveConfiguredRoots = configuredRoots.filter((root) => !isUnder(root, cacheRoot));
  const cachedConfiguredRoots = configuredRoots.filter((root) => isUnder(root, cacheRoot));
  const candidateRoots = [...toolsDocRoots, ...liveConfiguredRoots, ...cachedConfiguredRoots, offlineApiRoot];
  const extractedApiRoots: string[] = [];
  for (const api of API_DOCS) {
    const found = await findApiHtmlRoot(candidateRoots, api.names);
    if (!found) {
      throw new Error(`Offline API docs not found: ${api.names[0]}. Configure a doc root or install Reforger Tools.`);
    }
    extractedApiRoots.push(found);
  }

  const webSources = options.webSources ?? WEB_SOURCES;
  const savedWebPages: string[] = [];
  let downloadedPage = false;
  for (const source of webSources) {
    const fileName = `${slugify(source.category)}-${slugify(source.title)}.html`;
    const targetPath = path.join(webRoot, fileName);

    if (force || !(await fileExists(targetPath))) {
      const response = await (options.fetchPage ?? fetch)(source.url);
      if (!response.ok) {
        throw new Error(`Failed to download ${source.url}: ${response.status} ${response.statusText}`);
      }

      const body = await response.text();
      await writeFile(targetPath, body, "utf8");
      downloadedPage = true;
    }

    savedWebPages.push(targetPath);
  }

  const manifestPath = path.join(cacheRoot, "manifest.json");
  const manifestContent = { extractedApiRoots, savedWebPages, webSources };
  const priorManifest = await readManifest(manifestPath);
  const priorContent = priorManifest && {
    extractedApiRoots: priorManifest.extractedApiRoots,
    savedWebPages: priorManifest.savedWebPages,
    webSources: priorManifest.webSources,
  };
  if (force || downloadedPage || JSON.stringify(priorContent) !== JSON.stringify(manifestContent)) {
    await writeFile(
      manifestPath,
      JSON.stringify({ preparedAt: new Date().toISOString(), ...manifestContent }, null, 2),
      "utf8",
    );
  }

  return {
    cacheRoot,
    extractedApiRoots,
    savedWebPages,
    manifestPath,
  };
}

export function formatKnowledgeStatus(result: KnowledgePreparationResult): string {
  return [
    `Cache root: ${result.cacheRoot}`,
    `Offline API roots: ${result.extractedApiRoots.length}`,
    ...result.extractedApiRoots.map((root) => `- ${root}`),
    `Official web snapshots: ${result.savedWebPages.length}`,
    ...result.savedWebPages.map((page) => `- ${page}`),
    `Manifest: ${result.manifestPath}`,
  ].join("\n");
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadConfiguredDocRoots(cwd: string): Promise<string[]> {
  if (!(await fileExists(resolveConfigPath(cwd)))) {
    return [];
  }
  return (await loadConfig(cwd)).config.docRoots;
}

async function findApiHtmlRoot(roots: string[], folderNames: string[]): Promise<string | undefined> {
  for (const root of roots) {
    const directName = path.basename(root).toLowerCase() === "html"
      ? path.basename(path.dirname(root)).toLowerCase()
      : path.basename(root).toLowerCase();
    const directMatch = folderNames.some((name) => name.toLowerCase() === directName);
    const candidates = [
      ...(directMatch ? [root] : []),
      ...folderNames.map((name) => path.join(root, name)),
    ];
    for (const candidate of candidates) {
      for (const htmlRoot of [candidate, path.join(candidate, "html")]) {
        if (await fileExists(path.join(htmlRoot, "classes.html"))) {
          return path.resolve(htmlRoot);
        }
      }
    }
  }
  return undefined;
}

function isUnder(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function readManifest(manifestPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    return raw && typeof raw === "object" ? raw as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
