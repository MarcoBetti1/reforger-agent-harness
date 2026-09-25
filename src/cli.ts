import { loadConfig } from "./config.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { getRoots, listFiles, searchText } from "./fs-utils.js";
import { formatKnowledgeStatus, prepareKnowledge } from "./knowledge.js";
import { listBinaryAssetPaths, searchBinaryContext } from "./package-inspector.js";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "doctor": {
      const modIds = readRepeatedOption(rest, "--mod");
      const loaded = await loadConfig();
      const report = await runDoctor(loaded.config, modIds);
      process.stdout.write(`${formatDoctorReport(report)}\n`);
      return;
    }

    case "prepare-knowledge": {
      const force = rest.includes("--force");
      const result = await prepareKnowledge(process.cwd(), force);
      process.stdout.write(`${formatKnowledgeStatus(result)}\n`);
      return;
    }

    case "project-info": {
      const loaded = await loadConfig();
      process.stdout.write(
        [
          `Config: ${loaded.path}`,
          `Mod roots: ${loaded.config.modRoots.join(", ") || "(none)"}`,
          `Doc roots: ${loaded.config.docRoots.join(", ") || "(none)"}`,
          `Sample roots: ${loaded.config.sampleRoots.join(", ") || "(none)"}`,
        ].join("\n") + "\n",
      );
      return;
    }

    case "scan-mod": {
      const loaded = await loadConfig();
      const files = await listFiles(getRoots(loaded.config, "mod"), "**/*", 300);
      process.stdout.write(files.map((file) => `[${file.kind}] ${file.path}`).join("\n") + "\n");
      return;
    }

    case "search-text": {
      const query = rest[0];
      if (!query) {
        throw new Error("Usage: search-text <query> [--rootType all|mod|doc|sample] [--limit N]");
      }

      const rootType = (readOption(rest, "--rootType") ?? "all") as "all" | "mod" | "doc" | "sample";
      const limit = Number.parseInt(readOption(rest, "--limit") ?? "20", 10);
      const loaded = await loadConfig();
      const hits = await searchText(query, getRoots(loaded.config, rootType), limit);
      process.stdout.write(
        (hits.length === 0
          ? "No matches found."
          : hits.map((hit) => `[${hit.kind}] ${hit.path}:${hit.line} ${hit.snippet}`).join("\n")) + "\n",
      );
      return;
    }

    case "list-packaged-resources": {
      const filePath = rest[0];
      if (!filePath) {
        throw new Error("Usage: list-packaged-resources <path> [--limit N]");
      }

      const limit = Number.parseInt(readOption(rest, "--limit") ?? "200", 10);
      const results = await listBinaryAssetPaths(filePath, limit);
      process.stdout.write(results.join("\n") + "\n");
      return;
    }

    case "search-packaged-data": {
      const filePath = rest[0];
      const query = rest[1];
      if (!filePath || !query) {
        throw new Error("Usage: search-packaged-data <path> <query> [--limit N] [--window N]");
      }

      const limit = Number.parseInt(readOption(rest, "--limit") ?? "3", 10);
      const window = Number.parseInt(readOption(rest, "--window") ?? "800", 10);
      const results = await searchBinaryContext(filePath, query, limit, window);
      process.stdout.write(results.join("\n\n---\n\n") + "\n");
      return;
    }

    default:
      process.stdout.write(
        [
          "Commands:",
          "- doctor [--mod WORKSHOP_ID ...]",
          "- prepare-knowledge [--force]",
          "- project-info",
          "- scan-mod",
          "- search-text <query> [--rootType all|mod|doc|sample] [--limit N]",
          "- list-packaged-resources <path> [--limit N]",
          "- search-packaged-data <path> <query> [--limit N] [--window N]",
        ].join("\n") + "\n",
      );
  }
}

function readRepeatedOption(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== name) {
      continue;
    }
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`Missing value for ${name}.`);
    }
    values.push(args[++index]);
  }
  return values;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    return undefined;
  }

  return args[index + 1];
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
