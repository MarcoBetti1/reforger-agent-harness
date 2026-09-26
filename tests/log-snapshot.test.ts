import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { captureLogSnapshot, MAX_SNAPSHOT_BYTES, parseLogSnapshotArgs } from "../src/log-snapshot-cli.js";
import type { LogSnapshotOptions } from "../src/log-snapshot-cli.js";

const temporary: string[] = [];
async function fixture(): Promise<LogSnapshotOptions> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "log-snapshot-test-"));
  temporary.push(directory);
  return { logPath: path.join(directory, "console.log"), outputPath: path.join(directory, "evidence", "captured.log"), marker: "RESULT:[PASS]", timeoutMs: 2000, pollMs: 10 };
}
afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    const relative = path.relative(os.tmpdir(), directory);
    if (!relative.startsWith("log-snapshot-test-") || relative.includes(path.sep)) throw new Error("Unexpected temporary cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("live log snapshots", () => {
  it("captures full bytes with a busy append writer and a marker split across writes", async () => {
    const options = await fixture();
    // Keep this handle open until after capture, including on Windows.
    const writer = await open(options.logPath, "a");
    try {
      const prefix = Buffer.concat([Buffer.from([0xff]), Buffer.from("start\r\nRESULT:[PA")]);
      await writer.write(prefix);
      const capture = captureLogSnapshot(options);
      await delay(35);
      await expect(lstat(options.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
      const suffix = Buffer.from("SS]\r\nAlready in this read after marker\r\n");
      await writer.write(suffix);
      const result = await capture;
      const expected = Buffer.concat([prefix, suffix]);
      expect(await readFile(options.outputPath)).toEqual(expected);
      expect(result.output.bytes).toBe(expected.length);
      const hash = createHash("sha256").update(expected).digest("hex").toUpperCase();
      expect(result.source.sha256).toBe(hash);
      expect(result.output.sha256).toBe(hash);
      expect(result.firstMarkerOffsetBytes).toBe(expected.indexOf(Buffer.from(options.marker)));
      expect(result.method).toBe("first observed marker; up to poll latency");
      expect(Date.parse(result.capturedUtc)).toBeGreaterThanOrEqual(Date.parse(result.startedUtc));
      expect(result.attempts).toBeGreaterThan(1);
      expect(JSON.parse(await readFile(result.provenancePath, "utf8"))).toEqual(result);
      await writer.write("later live output\r\n");
      expect((await readFile(options.logPath)).length).toBeGreaterThan(result.output.bytes);
      expect(await readFile(options.outputPath)).toEqual(expected);
    } finally { await writer.close(); }
  });

  it("waits for a missing log to appear without creating empty evidence", async () => {
    const options = await fixture();
    const capture = captureLogSnapshot(options);
    await delay(25);
    await expect(lstat(options.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(options.logPath, `new log\n${options.marker}\ntrailing line\n`);
    const result = await capture;
    expect(result.attempts).toBeGreaterThan(1);
    expect(await readFile(options.outputPath)).toEqual(await readFile(options.logPath));
  });

  it("matches literal case-sensitive bytes, not a regular expression or partial marker", async () => {
    const options = { ...await fixture(), timeoutMs: 50 };
    await writeFile(options.logPath, "RESULT:P\nresult:[PASS]\nRESULT:[PAS");
    await expect(captureLogSnapshot(options)).rejects.toThrow("Timed out");
    expect(await readFile(options.logPath, "utf8")).toBe("RESULT:P\nresult:[PASS]\nRESULT:[PAS");
    await expect(lstat(options.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(`${options.outputPath}.provenance.json`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds timeout even when the polling interval is much longer", async () => {
    const options = { ...await fixture(), timeoutMs: 30, pollMs: 5000 };
    const start = performance.now();
    await expect(captureLogSnapshot(options)).rejects.toThrow(/Timed out.*ENOENT/);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(await readdir(path.dirname(options.logPath))).toEqual([]);
  });

  it.each(["snapshot", "provenance"])("never overwrites an existing %s", async kind => {
    const options = await fixture();
    options.outputPath = path.join(path.dirname(options.logPath), "snapshot.log");
    const occupied = kind === "snapshot" ? options.outputPath : `${options.outputPath}.provenance.json`;
    await writeFile(occupied, "existing evidence");
    await writeFile(options.logPath, options.marker);
    await expect(captureLogSnapshot(options)).rejects.toThrow("Refusing to overwrite");
    expect(await readFile(occupied, "utf8")).toBe("existing evidence");
    expect((await readdir(path.dirname(options.logPath))).sort()).toEqual(["console.log", path.basename(occupied)].sort());
  });

  it("lets only one concurrent watcher create a snapshot and matching provenance", async () => {
    const options = await fixture();
    await writeFile(options.logPath, `${options.marker}\nkept whole\n`);
    const results = await Promise.allSettled([captureLogSnapshot(options), captureLogSnapshot(options)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await readFile(options.outputPath)).toEqual(await readFile(options.logPath));
    const provenance = JSON.parse(await readFile(`${options.outputPath}.provenance.json`, "utf8"));
    expect(provenance.output.bytes).toBe((await readFile(options.outputPath)).length);
  });

  it("refuses a directory or oversized regular file without creating evidence", async () => {
    const options = await fixture();
    await expect(captureLogSnapshot({ ...options, logPath: path.dirname(options.logPath) })).rejects.toThrow("not a regular file");
    const source = await open(options.logPath, "w");
    await source.truncate(MAX_SNAPSHOT_BYTES + 1);
    await source.close();
    await expect(captureLogSnapshot(options)).rejects.toThrow("64 MiB");
    await expect(lstat(options.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects source/evidence aliases including the provenance destination", async () => {
    const options = await fixture();
    await expect(captureLogSnapshot({ ...options, outputPath: options.logPath })).rejects.toThrow("must differ");
    await expect(captureLogSnapshot({ ...options, logPath: `${options.outputPath}.provenance.json` })).rejects.toThrow("must differ");
  });
});

describe("snapshot CLI arguments", () => {
  const required = ["--log", "console.log", "--marker", "RESULT:[PASS]", "--output", "snapshot.log"];
  it("has bounded defaults and accepts explicit timeout and polling options", () => {
    expect(parseLogSnapshotArgs(required)).toMatchObject({ logPath: path.resolve("console.log"), outputPath: path.resolve("snapshot.log"), marker: "RESULT:[PASS]", timeoutMs: 600000, pollMs: 250 });
    expect(parseLogSnapshotArgs([...required, "--timeout-seconds", "0.05", "--poll-ms", "10"])).toMatchObject({ timeoutMs: 50, pollMs: 10 });
  });
  it.each([
    [], ["--marker", "x"], [...required, "--marker", "again"], [...required, "--poll-ms"],
    [...required, "--timeout-seconds", "Infinity"], [...required, "--timeout-seconds", "0"],
    [...required, "--timeout-seconds", "3601"], [...required, "--poll-ms", "0"],
    [...required, "--poll-ms", "1.5"], [...required, "--poll-ms", "5001"],
    [...required, "--unknown", "value"],
    ["--log", "console.log", "--marker", "", "--output", "snapshot.log"],
  ].map(args => ({ args })))("rejects invalid arguments $args", ({ args }) => { expect(() => parseLogSnapshotArgs(args)).toThrow(); });
});
