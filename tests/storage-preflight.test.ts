import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, statfs: vi.fn(original.statfs) };
});
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(() => { throw new Error("A storage-gate test must not launch a process."); }) };
});

import { MINIMUM_FREE_STORAGE_BYTES, requireStorageSpace } from "../src/storage-preflight.js";
import { runClientCli } from "../src/client-cli.js";
import { runRecordCli } from "../src/screen-record-cli.js";

const temporaryPrefix = path.join(os.tmpdir(), "reforger-storage-preflight-");
let temporary: string;

function freeBytes(available: bigint): void {
  vi.mocked(statfs).mockResolvedValue({
    type: 0n, bsize: 1n, blocks: 100n * MINIMUM_FREE_STORAGE_BYTES,
    bfree: 100n * MINIMUM_FREE_STORAGE_BYTES, bavail: available, files: 1000n, ffree: 1000n,
  });
}

beforeEach(() => {
  temporary = mkdtempSync(temporaryPrefix);
  vi.clearAllMocks();
  freeBytes(MINIMUM_FREE_STORAGE_BYTES);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(path.resolve(temporaryPrefix))) throw new Error("Unexpected temporary cleanup path.");
  rmSync(resolved, { recursive: true, force: true });
});

describe("storage preflight", () => {
  it("rejects below 2 GiB using user-available space rather than total free blocks", async () => {
    freeBytes(MINIMUM_FREE_STORAGE_BYTES - 1n);
    await expect(requireStorageSpace([temporary])).rejects.toThrow("at least 2147483648 bytes (2 GiB)");
  });

  it("accepts exactly 2 GiB and resolves a missing output to its existing ancestor without creating it", async () => {
    const output = path.join(temporary, "new-run", "logs");
    const checks = await requireStorageSpace([output]);
    expect(checks).toEqual([{ outputDirectory: output, existingAncestor: realpathSync(temporary), availableBytes: MINIMUM_FREE_STORAGE_BYTES }]);
    expect(statfs).toHaveBeenCalledWith(realpathSync(temporary), { bigint: true });
    expect(existsSync(path.dirname(output))).toBe(false);
  });

  it("probes the real destination behind a directory junction/symlink", async () => {
    const destination = path.join(temporary, "destination");
    const link = path.join(temporary, "output-link");
    mkdirSync(destination);
    symlinkSync(destination, link, process.platform === "win32" ? "junction" : "dir");
    await requireStorageSpace([path.join(link, "future-run", "logs")]);
    expect(statfs).toHaveBeenCalledWith(realpathSync(destination), { bigint: true });
    expect(existsSync(path.join(destination, "future-run"))).toBe(false);
  });

  it("fails closed when the filesystem probe fails", async () => {
    vi.mocked(statfs).mockRejectedValue(Object.assign(new Error("access denied"), { code: "EACCES" }));
    await expect(requireStorageSpace([path.join(temporary, "logs")])).rejects.toThrow("Cannot verify free storage");
    expect(existsSync(path.join(temporary, "logs"))).toBe(false);
  });

  it("rejects an existing file ancestor and a dangling junction rather than checking a different volume", async () => {
    const file = path.join(temporary, "file");
    writeFileSync(file, "evidence");
    await expect(requireStorageSpace([file])).rejects.toThrow("not a directory");
    const link = path.join(temporary, "dangling");
    symlinkSync(path.join(temporary, "absent"), link, process.platform === "win32" ? "junction" : "dir");
    await expect(requireStorageSpace([link])).rejects.toThrow("Cannot verify free storage");
    expect(statfs).not.toHaveBeenCalled();
  });

  it("checks each distinct output directory and rejects invalid filesystem counters", async () => {
    const profile = path.join(temporary, "profile");
    const logs = path.join(temporary, "logs");
    mkdirSync(profile);
    mkdirSync(logs);
    freeBytes(-1n);
    await expect(requireStorageSpace([profile])).rejects.toThrow("invalid available-space counters");
    freeBytes(MINIMUM_FREE_STORAGE_BYTES);
    vi.mocked(statfs).mockClear();
    await requireStorageSpace([profile, logs, profile]);
    expect(vi.mocked(statfs).mock.calls.map(([directory]) => directory)).toEqual([realpathSync(profile), realpathSync(logs)]);
  });
});

describe("execution boundaries", () => {
  function clientArgs(): string[] {
    const executable = path.join(temporary, "not-a-real-game.exe");
    writeFileSync(executable, "test fixture, never executed");
    return ["--game", executable, "--run-dir", path.join(temporary, "run"), "--profile", path.join(temporary, "profile")];
  }

  function recordArgs(): string[] {
    return ["--backend", "ddagrab", "--output-idx", "0", "--output", path.join(temporary, "video", "capture.mp4")];
  }

  it("refuses client execution before creating any run/profile output or spawning", async () => {
    freeBytes(0n);
    await expect(runClientCli([...clientArgs(), "--execute"])).rejects.toThrow("Insufficient free storage");
    expect(existsSync(path.join(temporary, "run"))).toBe(false);
    expect(existsSync(path.join(temporary, "profile"))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses recorder execution before creating the video directory or spawning", async () => {
    freeBytes(0n);
    await expect(runRecordCli([...recordArgs(), "--execute"])).rejects.toThrow("Insufficient free storage");
    expect(existsSync(path.join(temporary, "video"))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("creates no client directories when only the later logs destination is short of space", async () => {
    const args = clientArgs();
    const profile = path.join(temporary, "profile");
    const logs = path.join(temporary, "run", "logs");
    mkdirSync(profile);
    mkdirSync(logs, { recursive: true });
    const resolvedLogs = realpathSync(logs);
    vi.mocked(statfs).mockImplementation(async (directory) => ({
      type: 0n, bsize: 1n, blocks: MINIMUM_FREE_STORAGE_BYTES,
      bfree: MINIMUM_FREE_STORAGE_BYTES, bavail: directory === resolvedLogs ? 0n : MINIMUM_FREE_STORAGE_BYTES,
      files: 1000n, ffree: 1000n,
    }));
    await expect(runClientCli([...args, "--execute"])).rejects.toThrow(`Insufficient free storage for ${logs}`);
    expect(existsSync(path.join(profile, "profile"))).toBe(false);
    expect(existsSync(path.join(profile, "addons"))).toBe(false);
    expect(existsSync(path.join(logs, "console.log"))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("leaves both dry runs usable even when a storage probe would fail", async () => {
    vi.mocked(statfs).mockRejectedValue(new Error("probe unavailable"));
    await expect(runClientCli(clientArgs())).resolves.toBe(0);
    await expect(runRecordCli(recordArgs())).resolves.toBe(0);
    expect(statfs).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(path.join(temporary, "run"))).toBe(false);
    expect(existsSync(path.join(temporary, "profile"))).toBe(false);
    expect(existsSync(path.join(temporary, "video"))).toBe(false);
  });

  it("rejects a dangling recording output link before probing a volume or spawning", async () => {
    const output = path.join(temporary, "capture.mp4");
    const target = path.join(temporary, "missing-target.mp4");
    // Junctions exercise the same lstat/exists distinction on Windows without
    // requiring the privilege needed to create a file symlink.
    symlinkSync(target, output, process.platform === "win32" ? "junction" : "file");
    expect(existsSync(output)).toBe(false);
    await expect(runRecordCli(["--window-title", "Unused", "--output", output, "--execute"]))
      .rejects.toThrow("Refusing to overwrite existing recording or output link");
    expect(statfs).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(target)).toBe(false);
  });
});
