import path from "node:path";
import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import { cachePakText, findExactResource, normalizeResource, readPakIndex, readPakText, sourceProvenance } from "./pak-source.js";
import type { PakEntry, PakIndex } from "./pak-source.js";

const HELP = `Selective installed PAC1 source inspection (read-only package access)
Usage: npm run pak:source -- <list|find|read|extract> [options]
  --pack PATH       One package; repeat to inspect multiple packages
  --root DIRECTORY  Recursively discover .pak files; repeat for addon roots
  --resource PATH   Exact mounted resource path for find/read/extract
  --filter TEXT     Case-insensitive path substring for list
  --limit N         Maximum list rows (default 200; maximum 5000)

list/find print JSON metadata. read prints only the requested UTF-8 source
to stdout and provenance to stderr. extract writes only that source below
the current directory's ignored .cache/pak-source and refuses overwrite.
Multiple matching packs are reported by find; read/extract require one.
No game process is launched and no game/package file is modified.
`;

export interface PakSourceOptions { command: string; packs: string[]; roots: string[]; resource?: string; filter: string; limit: number }

export function parsePakSourceArgs(args: string[]): PakSourceOptions {
  const [command, ...rest] = args;
  if (!["list", "find", "read", "extract"].includes(command)) throw new Error(HELP);
  const result: PakSourceOptions = { command, packs: [], roots: [], filter: "", limit: 200 };
  const seen = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!["--pack", "--root", "--resource", "--filter", "--limit"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    if (flag !== "--pack" && flag !== "--root" && seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--pack") result.packs.push(value);
    if (flag === "--root") result.roots.push(value);
    if (flag === "--resource") result.resource = normalizeResource(value);
    if (flag === "--filter") result.filter = value.toLowerCase();
    if (flag === "--limit") {
      if (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > 5000) throw new Error("--limit must be an integer from 1 to 5000.");
      result.limit = Number(value);
    }
  }
  if (!result.packs.length && !result.roots.length) throw new Error("Supply --pack or --root explicitly.");
  if (command !== "list" && !result.resource) throw new Error("Supply --resource with an exact mounted resource path.");
  if (command === "list" && result.resource) throw new Error("Use find for an exact --resource path.");
  if (command !== "list" && (seen.has("--filter") || seen.has("--limit"))) throw new Error("--filter and --limit apply only to list.");
  return result;
}

export async function runPakSource(args: string[], cwd = process.cwd()): Promise<void> {
  if (!args.length || args.includes("--help")) { process.stdout.write(HELP); return; }
  const options = parsePakSourceArgs(args);
  const candidates = [...options.packs];
  for (const root of options.roots) candidates.push(...await fg("**/*.pak", { cwd: path.resolve(cwd, root), absolute: true, onlyFiles: true, followSymbolicLinks: false }));
  if (candidates.length > 512) throw new Error("More than 512 packages selected; narrow --root.");
  const packs = [...new Set(await Promise.all(candidates.map((candidate) => realpath(path.resolve(cwd, candidate)))))].sort();
  if (!packs.length) throw new Error("No packages found.");
  const matches: { index: PakIndex; entry: PakEntry }[] = [];
  const rows: object[] = [];
  let totalMatches = 0;
  for (const pack of packs) {
    let index: PakIndex;
    try { index = await readPakIndex(pack); } catch (error) { throw new Error(`${pack}: ${error instanceof Error ? error.message : error}`); }
    if (options.command === "list") {
      for (const entry of index.entries) {
        if (!entry.resource.toLowerCase().includes(options.filter)) continue;
        totalMatches++;
        if (rows.length < options.limit) rows.push(sourceProvenance(index, entry));
      }
    } else {
      const entry = findExactResource(index, options.resource!);
      // Retain only the selected entry across packages, not every tree.
      if (entry) matches.push({ index: { ...index, entries: [entry] }, entry });
    }
  }
  if (options.command === "list") {
    process.stdout.write(`${JSON.stringify({ scannedPacks: packs.length, totalMatches, truncated: totalMatches > rows.length, resources: rows }, null, 2)}\n`);
    return;
  }
  if (options.command === "find") {
    process.stdout.write(`${JSON.stringify({ scannedPacks: packs.length, matches: matches.map(({ index, entry }) => sourceProvenance(index, entry)) }, null, 2)}\n`);
    if (!matches.length) process.exitCode = 1;
    return;
  }
  if (matches.length !== 1) throw new Error(matches.length ? "Resource occurs in multiple packages. Use find, then select one --pack explicitly." : "Exact resource path was not found.");
  const { index, entry } = matches[0];
  const raw = await readPakText(index, entry);
  if (options.command === "read") {
    process.stderr.write(`${JSON.stringify(sourceProvenance(index, entry, raw))}\n`);
    process.stdout.write(raw);
  } else {
    const output = await cachePakText(cwd, index, entry, raw);
    process.stdout.write(`${JSON.stringify({ output, ...sourceProvenance(index, entry, raw) }, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPakSource(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
