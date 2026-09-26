import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { inflateSync } from "node:zlib";

// Observed PAC1 layout, not a general Enfusion package implementation.
export const PAK_LIMITS = { indexBytes: 32 * 1024 * 1024, textBytes: 4 * 1024 * 1024, entries: 250_000, depth: 64 };
const TEXT_EXTENSIONS = new Set([".c", ".conf", ".et", ".ent", ".layer", ".bt", ".layout", ".gproj", ".json", ".txt", ".xml", ".cfg", ".emat", ".gamemat", ".meta"]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface PakEntry {
  resource: string;
  offset: number;
  storedBytes: number;
  rawBytes: number;
  method: string;
}

export interface PakIndex {
  pack: string;
  size: number;
  mtimeMs: number;
  headerHex: string;
  indexSha256: string;
  indexBytes: number;
  entries: PakEntry[];
}

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeSegment(value: string): void {
  if (!value || value === "." || value === ".." || /[\\/:\x00-\x1f\x7f]/u.test(value)) {
    throw new Error(`Unsafe resource path segment: ${JSON.stringify(value)}`);
  }
}

export function normalizeResource(value: string): string {
  // Resource paths are relative mounted paths; a basename matches only a
  // root resource, never a file with that name deeper in the directory tree.
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  for (const segment of segments) safeSegment(segment);
  return segments.join("/");
}

export function parsePakTree(buffer: Buffer, dataStart: number, dataEnd: number): PakEntry[] {
  if (buffer.length > PAK_LIMITS.indexBytes) throw new Error("Package index exceeds the byte limit.");
  if (!Number.isSafeInteger(dataStart) || !Number.isSafeInteger(dataEnd) || dataStart < 0 || dataEnd < dataStart) {
    throw new Error("Invalid package DATA bounds.");
  }
  let cursor = 0;
  let count = 0;
  const entries: PakEntry[] = [];
  const seen = new Set<string>();
  function requireBytes(amount: number): void {
    if (cursor + amount > buffer.length) throw new Error("Truncated package directory record.");
  }
  function visit(parent: string, depth: number): void {
    if (depth > PAK_LIMITS.depth || ++count > PAK_LIMITS.entries) throw new Error("Package directory complexity exceeds the limit.");
    requireBytes(2);
    const type = buffer[cursor++];
    const length = buffer[cursor++];
    requireBytes(length);
    const name = utf8.decode(buffer.subarray(cursor, cursor + length));
    cursor += length;
    if (depth === 0) {
      if (type !== 0 || name !== "") throw new Error("Unsupported package root directory.");
    } else {
      safeSegment(name);
    }
    const resource = parent ? `${parent}/${name}` : name;
    if (depth > 0) {
      const key = resource.toLowerCase();
      if (seen.has(key)) throw new Error(`Duplicate resource path: ${resource}`);
      seen.add(key);
    }
    if (type === 0) {
      requireBytes(4);
      const children = buffer.readUInt32LE(cursor);
      cursor += 4;
      if (children > PAK_LIMITS.entries - count) throw new Error("Package child count exceeds the limit.");
      for (let index = 0; index < children; index++) visit(resource, depth + 1);
    } else if (type === 1) {
      requireBytes(24);
      const offset = buffer.readUInt32LE(cursor);
      const storedBytes = buffer.readUInt32LE(cursor + 4);
      const rawBytes = buffer.readUInt32LE(cursor + 8);
      const method = buffer.subarray(cursor + 16, cursor + 20).toString("hex");
      cursor += 24;
      if (offset < dataStart || offset + storedBytes > dataEnd) throw new Error(`Resource is outside DATA: ${resource}`);
      entries.push({ resource, offset, storedBytes, rawBytes, method });
    } else {
      throw new Error(`Unsupported directory entry type: ${type}`);
    }
  }
  visit("", 0);
  if (cursor !== buffer.length) throw new Error("Unexpected trailing package index data.");
  return entries;
}

async function readExact(file: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await file.read(buffer, done, length - done, offset + done);
    if (!bytesRead) throw new Error("Package changed or was truncated during read.");
    done += bytesRead;
  }
  return buffer;
}

export async function readPakIndex(packPath: string): Promise<PakIndex> {
  const pack = await realpath(packPath);
  const file = await open(pack, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 62 || stat.size > 0xffff_ffff + 8) throw new Error("Unsupported package size or type.");
    const prefix = await readExact(file, 0, 12);
    if (prefix.toString("ascii", 0, 4) !== "FORM" || prefix.toString("ascii", 8, 12) !== "PAC1" || prefix.readUInt32BE(4) + 8 !== stat.size) {
      throw new Error("Expected an intact FORM/PAC1 package.");
    }
    let cursor = 12;
    let headerHex = "";
    let dataStart = 0;
    let dataEnd = 0;
    let tree: Buffer | undefined;
    const expected = ["HEAD", "DATA", "FILE"];
    for (const tag of expected) {
      if (cursor + 8 > stat.size) throw new Error(`Missing ${tag} chunk.`);
      const chunk = await readExact(file, cursor, 8);
      const size = chunk.readUInt32BE(4);
      if (chunk.toString("ascii", 0, 4) !== tag || cursor + 8 + size > stat.size) throw new Error(`Invalid or unsupported ${tag} chunk.`);
      const start = cursor + 8;
      if (tag === "HEAD") {
        if (size !== 28) throw new Error("Unsupported PAC1 HEAD size.");
        const header = await readExact(file, start, size);
        if (header.subarray(0, 4).toString("hex") !== "03000100") throw new Error("Unsupported PAC1 header version.");
        headerHex = header.toString("hex");
      } else if (tag === "DATA") {
        dataStart = start;
        dataEnd = start + size;
      } else {
        if (size > PAK_LIMITS.indexBytes) throw new Error("Package index exceeds the byte limit.");
        tree = await readExact(file, start, size);
      }
      cursor = start + size;
    }
    if (cursor !== stat.size || !tree) throw new Error("Unsupported package chunks or trailing data.");
    const entries = parsePakTree(tree, dataStart, dataEnd);
    const after = await file.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("Package changed during index read.");
    return { pack, size: stat.size, mtimeMs: stat.mtimeMs, headerHex, indexSha256: hash(tree), indexBytes: tree.length, entries };
  } finally {
    await file.close();
  }
}

export function findExactResource(index: PakIndex, resource: string): PakEntry | undefined {
  const requested = normalizeResource(resource).toLowerCase();
  return index.entries.find((entry) => entry.resource.toLowerCase() === requested);
}

export function decodePakText(stored: Buffer, entry: PakEntry): Buffer {
  if (!TEXT_EXTENSIONS.has(path.posix.extname(entry.resource).toLowerCase())) throw new Error("Only explicitly supported text resource extensions may be read.");
  if (entry.rawBytes > PAK_LIMITS.textBytes || entry.storedBytes > PAK_LIMITS.textBytes) throw new Error("Requested text resource exceeds the 4 MiB limit.");
  if (stored.length !== entry.storedBytes) throw new Error("Stored resource size does not match its index.");
  let raw: Buffer;
  if (entry.method === "00000000") {
    if (entry.storedBytes !== entry.rawBytes) throw new Error("Invalid uncompressed resource lengths.");
    raw = stored;
  } else if (entry.method === "00000106") {
    raw = inflateSync(stored, { maxOutputLength: Math.max(1, entry.rawBytes) });
  } else {
    throw new Error(`Unsupported compression metadata: ${entry.method}`);
  }
  if (raw.length !== entry.rawBytes) throw new Error("Decompressed resource size does not match its index.");
  const text = utf8.decode(raw);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new Error("Requested resource contains binary/control data, not supported UTF-8 text.");
  return raw;
}

export async function readPakText(index: PakIndex, entry: PakEntry): Promise<Buffer> {
  // Reject oversized selections before allocation or reading their payload.
  if (entry.rawBytes > PAK_LIMITS.textBytes || entry.storedBytes > PAK_LIMITS.textBytes) throw new Error("Requested text resource exceeds the 4 MiB limit.");
  const member = findExactResource(index, entry.resource);
  if (member !== entry) throw new Error("Resource entry does not belong to this package index.");
  const file = await open(index.pack, "r");
  try {
    const before = await file.stat();
    if (before.size !== index.size || before.mtimeMs !== index.mtimeMs || (await readExact(file, 20, 28)).toString("hex") !== index.headerHex) {
      throw new Error("Package changed since it was indexed; search it again.");
    }
    const raw = decodePakText(await readExact(file, entry.offset, entry.storedBytes), entry);
    const after = await file.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("Package changed during resource read.");
    return raw;
  } finally {
    await file.close();
  }
}

export async function cachePakText(cwd: string, index: PakIndex, entry: PakEntry, raw: Buffer): Promise<string> {
  const segments = normalizeResource(entry.resource).split("/");
  for (const segment of segments) {
    if (/[<>"|?*]/u.test(segment) || /[. ]$/u.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)) {
      throw new Error("Resource path cannot be safely cached on Windows.");
    }
  }
  const base = await realpath(cwd);
  const identity = hash(Buffer.from(`${index.pack}\n${index.indexSha256}`)).slice(0, 20);
  let directory = base;
  // Walk one segment at a time: reject existing symlinks/junctions, including
  // .cache itself, and never accept an arbitrary output destination.
  for (const segment of [".cache", "pak-source", identity, ...segments.slice(0, -1)]) {
    directory = path.join(directory, segment);
    await mkdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Cache path contains a link or non-directory.");
    const resolved = await realpath(directory);
    const relative = path.relative(base, resolved);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("Cache path leaves the workspace.");
  }
  const destination = path.join(directory, segments.at(-1)!);
  const file = await open(destination, "wx");
  try { await file.writeFile(raw); } finally { await file.close(); }
  return destination;
}

export function sourceProvenance(index: PakIndex, entry: PakEntry, raw?: Buffer): object {
  return { pack: index.pack, packBytes: index.size, packModifiedUtc: new Date(index.mtimeMs).toISOString(), headerHex: index.headerHex,
    indexBytes: index.indexBytes, indexSha256: index.indexSha256, ...entry, ...(raw ? { sourceSha256: hash(raw) } : {}) };
}
