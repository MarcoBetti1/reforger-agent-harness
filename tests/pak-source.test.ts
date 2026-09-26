import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { parsePakSourceArgs } from "../src/pak-source-cli.js";
import { cachePakText, decodePakText, findExactResource, normalizeResource, PAK_LIMITS, parsePakTree, readPakIndex, readPakText } from "../src/pak-source.js";
import type { PakEntry } from "../src/pak-source.js";

const temporary: string[] = [];
async function temp(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pak-source-test-"));
  temporary.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

function u32(value: number, big = false): Buffer {
  const buffer = Buffer.alloc(4);
  if (big) buffer.writeUInt32BE(value); else buffer.writeUInt32LE(value);
  return buffer;
}
function directory(name: string, children: Buffer[]): Buffer {
  const encoded = Buffer.from(name);
  return Buffer.concat([Buffer.from([0, encoded.length]), encoded, u32(children.length), ...children]);
}
function leaf(name: string, offset: number, stored: number, raw = stored, method = "00000000"): Buffer {
  const encoded = Buffer.from(name);
  return Buffer.concat([Buffer.from([1, encoded.length]), encoded, u32(offset), u32(stored), u32(raw), Buffer.alloc(4), Buffer.from(method, "hex"), Buffer.alloc(4)]);
}
function chunk(tag: string, bytes: Buffer): Buffer { return Buffer.concat([Buffer.from(tag), u32(bytes.length, true), bytes]); }
function fixture(): { bytes: Buffer; first: Buffer; second: Buffer } {
  const first = Buffer.from("class Example {\n  string value = \"synthetic only\";\n}\n");
  const second = Buffer.from("class OtherExample {}\n");
  const compressed = deflateSync(first);
  const tree = directory("", [directory("scripts", [
    directory("Game", [leaf("Example.c", 56, compressed.length, first.length, "00000106")]),
    directory("Editor", [leaf("Example.c", 56 + compressed.length, second.length)]),
  ])]);
  const head = Buffer.alloc(28); Buffer.from("03000100", "hex").copy(head);
  const body = Buffer.concat([Buffer.from("PAC1"), chunk("HEAD", head), chunk("DATA", Buffer.concat([compressed, second])), chunk("FILE", tree)]);
  return { bytes: Buffer.concat([Buffer.from("FORM"), u32(body.length, true), body]), first, second };
}
async function savedFixture(): Promise<{ pack: string; directory: string; bytes: Buffer; first: Buffer; second: Buffer }> {
  const value = fixture(); const directory = await temp(); const pack = path.join(directory, "synthetic.pak");
  await writeFile(pack, value.bytes);
  return { pack, directory, ...value };
}

describe("bounded PAC1 source inspection", () => {
  it("reconstructs full paths and reads raw/zlib text without confusing duplicate basenames", async () => {
    const source = await savedFixture(); const index = await readPakIndex(source.pack);
    expect(index.entries.map((entry) => entry.resource)).toEqual(["scripts/Game/Example.c", "scripts/Editor/Example.c"]);
    expect(findExactResource(index, "Example.c")).toBeUndefined();
    const compressed = findExactResource(index, "SCRIPTS\\GAME\\EXAMPLE.C")!;
    expect(await readPakText(index, compressed)).toEqual(source.first);
    expect(await readPakText(index, findExactResource(index, "scripts/Editor/Example.c")!)).toEqual(source.second);
    expect(await readFile(source.pack)).toEqual(source.bytes);
    expect(index.indexSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rejects traversal, absolute and encoded directory separators", () => {
    for (const name of ["..", ".", "a/b", "a\\b", "C:", "\u0000"]) {
      expect(() => parsePakTree(directory("", [directory(name, [])]), 56, 56)).toThrow(/Unsafe/u);
    }
    for (const resource of ["../Example.c", "/scripts/Example.c", "C:\\scripts\\Example.c", "scripts//Example.c"]) {
      expect(() => normalizeResource(resource)).toThrow(/Unsafe/u);
    }
  });

  it("rejects truncated trees, impossible counts, duplicate paths and unknown entry types", () => {
    expect(() => parsePakTree(Buffer.from([0, 0]), 56, 56)).toThrow(/Truncated/u);
    expect(() => parsePakTree(Buffer.concat([Buffer.from([0, 0]), u32(0xffffffff)]), 56, 56)).toThrow(/count/u);
    expect(() => parsePakTree(directory("", [directory("scripts", []), directory("SCRIPTS", [])]), 56, 56)).toThrow(/Duplicate/u);
    expect(() => parsePakTree(directory("", [Buffer.from([2, 1, 97])]), 56, 56)).toThrow(/entry type/u);
    expect(() => parsePakTree(Buffer.concat([directory("", []), Buffer.from([0])]), 56, 56)).toThrow(/trailing/u);
  });

  it("enforces DATA bounds and nesting limits", () => {
    expect(() => parsePakTree(directory("", [leaf("Example.c", 55, 1)]), 56, 100)).toThrow(/outside DATA/u);
    expect(() => parsePakTree(directory("", [leaf("Example.c", 99, 2)]), 56, 100)).toThrow(/outside DATA/u);
    let tree = directory("end", []);
    for (let i = 0; i < PAK_LIMITS.depth + 1; i++) tree = directory(`d${i}`, [tree]);
    expect(() => parsePakTree(directory("", [tree]), 56, 56)).toThrow(/complexity/u);
  });

  it("rejects unknown versions and corrupted chunk sizes", async () => {
    const source = await savedFixture(); const badVersion = Buffer.from(source.bytes); badVersion[20] = 4;
    await writeFile(source.pack, badVersion);
    await expect(readPakIndex(source.pack)).rejects.toThrow(/header version/u);
    const badChunk = Buffer.from(source.bytes); badChunk.writeUInt32BE(0xffffffff, 52);
    await writeFile(source.pack, badChunk);
    await expect(readPakIndex(source.pack)).rejects.toThrow(/DATA chunk/u);
    await writeFile(source.pack, source.bytes.subarray(0, source.bytes.length - 1));
    await expect(readPakIndex(source.pack)).rejects.toThrow(/intact/u);
  });

  it("refuses oversized decoded lengths before decompression and checks actual output size", () => {
    const stored = deflateSync(Buffer.from("A".repeat(2048)));
    const entry: PakEntry = { resource: "scripts/Test.c", offset: 56, storedBytes: stored.length, rawBytes: PAK_LIMITS.textBytes + 1, method: "00000106" };
    expect(() => decodePakText(stored, entry)).toThrow(/4 MiB/u);
    expect(() => decodePakText(stored, { ...entry, rawBytes: 32 })).toThrow();
    expect(() => decodePakText(stored, { ...entry, rawBytes: 2049 })).toThrow(/size does not match/u);
    expect(() => decodePakText(stored, { ...entry, rawBytes: 2048, method: "ffffffff" })).toThrow(/compression/u);
  });

  it("rejects unsupported extensions, binary controls, invalid UTF-8 and raw length mismatch", () => {
    const entry: PakEntry = { resource: "scripts/Test.c", offset: 56, storedBytes: 2, rawBytes: 2, method: "00000000" };
    expect(() => decodePakText(Buffer.from([65, 0]), entry)).toThrow(/binary/u);
    expect(() => decodePakText(Buffer.from([0xc3, 0x28]), entry)).toThrow();
    expect(() => decodePakText(Buffer.from("ab"), { ...entry, resource: "textures/Test.edds" })).toThrow(/extensions/u);
    expect(() => decodePakText(Buffer.from("ab"), { ...entry, rawBytes: 3 })).toThrow(/lengths/u);
  });

  it("detects package changes between index and source reads", async () => {
    const source = await savedFixture(); const index = await readPakIndex(source.pack);
    await writeFile(source.pack, Buffer.concat([source.bytes, Buffer.from([0])]));
    await expect(readPakText(index, index.entries[0])).rejects.toThrow(/changed/u);
  });

  it("caches only the selected text under .cache and refuses overwrite", async () => {
    const source = await savedFixture(); const index = await readPakIndex(source.pack); const entry = index.entries[0];
    const output = await cachePakText(source.directory, index, entry, source.first);
    expect(path.relative(source.directory, output)).toMatch(/^\.cache[\\/]pak-source[\\/]/u);
    expect(await readFile(output)).toEqual(source.first);
    await expect(cachePakText(source.directory, index, entry, source.first)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(source.pack)).toEqual(source.bytes);
  });

  it("rejects a redirected cache directory and reserved Windows names", async () => {
    const source = await savedFixture(); const index = await readPakIndex(source.pack); const elsewhere = await temp();
    await symlink(elsewhere, path.join(source.directory, ".cache"), process.platform === "win32" ? "junction" : "dir");
    await expect(cachePakText(source.directory, index, index.entries[0], source.first)).rejects.toThrow(/link/u);
    await expect(cachePakText(source.directory, index, { ...index.entries[0], resource: "scripts/CON.c" }, source.first)).rejects.toThrow(/Windows/u);
  });

  it("validates CLI options and exact resource paths", () => {
    expect(parsePakSourceArgs(["find", "--root", "game", "--resource", "scripts/Test.c"]).resource).toBe("scripts/Test.c");
    expect(() => parsePakSourceArgs(["find", "--pack", "a.pak"])).toThrow(/resource/u);
    expect(() => parsePakSourceArgs(["list", "--pack", "a.pak", "--limit", "3oops"])).toThrow(/integer/u);
    expect(() => parsePakSourceArgs(["read", "--pack", "a.pak", "--resource", "../Test.c"])).toThrow(/Unsafe/u);
    expect(() => parsePakSourceArgs(["read", "--pack", "a.pak", "--resource", "scripts/Test.c", "--execute"])).toThrow(/Unknown/u);
  });
});
