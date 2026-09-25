import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, type LoadedConfig } from "./config.js";
import {
  getRoots,
  listFiles,
  looksLikeReforgerSource,
  resolveAccessiblePath,
  safeReadText,
  searchText,
  type RootFilter,
} from "./fs-utils.js";
import { listBinaryAssetPaths, searchBinaryContext } from "./package-inspector.js";

const server = new McpServer({
  name: "reforger-mcp",
  version: "0.1.0",
});

const rootTypeSchema = z.enum(["all", "mod", "doc", "sample"]).optional();

server.tool("project_info", "Show the active Reforger helper config and accessible roots.", {}, async () => {
  try {
    const loaded = await loadConfig();
    return asText(renderProjectInfo(loaded));
  } catch (error) {
    return asText(renderError(error));
  }
});

server.tool(
  "scan_mod",
  "Summarize likely Reforger mod files and script folders under configured mod roots.",
  {
    limit: z.number().int().min(1).max(300).optional(),
  },
  async ({ limit = 120 }) => {
    try {
      const loaded = await loadConfig();
      const modRoots = getRoots(loaded.config, "mod");

      if (modRoots.length === 0) {
        return asText("No mod roots are configured.");
      }

      const files = await listFiles(modRoots, "**/*", 2000);
      const reforgerFiles = files.filter((file) => looksLikeReforgerSource(file.path)).slice(0, limit);
      const gprojFiles = reforgerFiles.filter((file) => file.path.endsWith(".gproj"));
      const gameCodeFiles = reforgerFiles.filter((file) =>
        file.path.replace(/\\/g, "/").includes("/Scripts/GameCode/"),
      );
      const workbenchFiles = reforgerFiles.filter((file) =>
        file.path.replace(/\\/g, "/").includes("/Scripts/WorkbenchGame/"),
      );

      return asText(
        [
          `Config: ${loaded.path}`,
          `Mod roots: ${modRoots.length}`,
          `Indexed files scanned: ${files.length}`,
          `Likely Reforger source files: ${reforgerFiles.length}`,
          `Project files (.gproj): ${gprojFiles.length}`,
          `GameCode scripts: ${gameCodeFiles.length}`,
          `WorkbenchGame scripts: ${workbenchFiles.length}`,
          "",
          "Sample files:",
          ...reforgerFiles.slice(0, limit).map((file) => `- [${file.kind}] ${file.path}`),
        ].join("\n"),
      );
    } catch (error) {
      return asText(renderError(error));
    }
  },
);

server.tool(
  "list_files",
  "List files under configured mod, docs, or sample roots.",
  {
    rootType: rootTypeSchema,
    pattern: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  async ({ rootType = "all", pattern = "**/*", limit = 100 }) => {
    try {
      const loaded = await loadConfig();
      const roots = getRoots(loaded.config, rootType as RootFilter);

      if (roots.length === 0) {
        return asText(`No roots are configured for rootType=${rootType}.`);
      }

      const files = await listFiles(roots, pattern, limit);
      return asText(files.map((file) => `[${file.kind}] ${file.path}`).join("\n") || "No files found.");
    } catch (error) {
      return asText(renderError(error));
    }
  },
);

server.tool(
  "search_text",
  "Search text inside configured mod, docs, or sample roots.",
  {
    query: z.string().min(2),
    rootType: rootTypeSchema,
    limit: z.number().int().min(1).max(50).optional(),
  },
  async ({ query, rootType = "all", limit = 20 }) => {
    try {
      const loaded = await loadConfig();
      const roots = getRoots(loaded.config, rootType as RootFilter);

      if (roots.length === 0) {
        return asText(`No roots are configured for rootType=${rootType}.`);
      }

      const hits = await searchText(query, roots, limit);
      return asText(
        hits.length === 0
          ? "No matches found."
          : hits.map((hit) => `[${hit.kind}] ${hit.path}:${hit.line} ${hit.snippet}`).join("\n"),
      );
    } catch (error) {
      return asText(renderError(error));
    }
  },
);

server.tool(
  "read_text_file",
  "Read a text file that lives inside configured roots.",
  {
    path: z.string().min(1),
    maxCharacters: z.number().int().min(200).max(200_000).optional(),
  },
  async ({ path, maxCharacters = 12_000 }) => {
    try {
      const loaded = await loadConfig();
      const roots = getRoots(loaded.config, "all");
      const resolved = await resolveAccessiblePath(path, roots);

      if (!resolved) {
        return asText(`Path is not accessible through configured roots: ${path}`);
      }

      const content = await safeReadText(resolved, maxCharacters);
      return asText(`File: ${resolved}\n\n${content}`);
    } catch (error) {
      return asText(renderError(error));
    }
  },
);

server.tool(
  "list_packaged_resources",
  "List asset-like resource paths discovered inside a packaged .pak or resourceDatabase.rdb file.",
  {
    path: z.string().min(1),
    limit: z.number().int().min(1).max(2000).optional(),
  },
  async ({ path, limit = 400 }) => {
    try {
      const loaded = await loadConfig();
      const roots = getRoots(loaded.config, "all");
      const resolved = await resolveAccessiblePath(path, roots);

      if (!resolved) {
        return asText(`Path is not accessible through configured roots: ${path}`);
      }

      const resources = await listBinaryAssetPaths(resolved, limit);
      return asText(resources.join("\n") || "No asset-like paths found.");
    } catch (error) {
      return asText(renderError(error));
    }
  },
);

server.tool(
  "search_packaged_data",
  "Search printable text windows inside a packaged .pak or resourceDatabase.rdb file.",
  {
    path: z.string().min(1),
    query: z.string().min(2),
    limit: z.number().int().min(1).max(20).optional(),
    window: z.number().int().min(50).max(10_000).optional(),
  },
  async ({ path, query, limit = 3, window = 800 }) => {
    try {
      const loaded = await loadConfig();
      const roots = getRoots(loaded.config, "all");
      const resolved = await resolveAccessiblePath(path, roots);

      if (!resolved) {
        return asText(`Path is not accessible through configured roots: ${path}`);
      }

      const matches = await searchBinaryContext(resolved, query, limit, window);
      return asText(matches.join("\n\n---\n\n") || "No matches found.");
    } catch (error) {
      return asText(renderError(error));
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function asText(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function renderProjectInfo(loaded: LoadedConfig): string {
  return [
    `Config: ${loaded.path}`,
    `Mod roots: ${loaded.config.modRoots.length ? loaded.config.modRoots.join(", ") : "(none)"}`,
    `Doc roots: ${loaded.config.docRoots.length ? loaded.config.docRoots.join(", ") : "(none)"}`,
    `Sample roots: ${loaded.config.sampleRoots.length ? loaded.config.sampleRoots.join(", ") : "(none)"}`,
  ].join("\n");
}

function renderError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return "Error: unknown failure";
}

main().catch((error) => {
  process.stderr.write(`${renderError(error)}\n`);
  process.exitCode = 1;
});
