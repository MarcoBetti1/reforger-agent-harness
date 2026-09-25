import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeWorkbenchPlan, parseWorkbenchArgs, verifyPackResult } from "../src/workbench-cli.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function createPackEvidence() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workbench-pack-"));
  tempDirs.push(dir);
  const output = path.join(dir, "output");
  const logs = path.join(dir, "logs");
  mkdirSync(output);
  mkdirSync(logs);
  const startedAtMs = Date.now() - 2000;
  writeFileSync(path.join(logs, "console.log"), "12:56:07.376  RESOURCES    : Packaging project successful\n");
  writeFileSync(path.join(output, "data.pak"), "packed contents");
  return { output, logs, startedAtMs };
}

describe("Workbench command planning", () => {
  const project = path.resolve("test addon", "addon.gproj");
  const output = path.resolve("packed addon");
  const tool = path.resolve("Workbench.exe");
  const logsDir = path.resolve("logs");
  const gameAddons = path.resolve("game addons");

  it("defaults to dry run and validates scripts without packing", () => {
    const options = parseWorkbenchArgs(["validate", "--project", project]);
    expect(options.execute).toBe(false);
    expect(options.configuration).toBe("PC");
    expect(makeWorkbenchPlan(options, tool, logsDir, gameAddons)).toEqual([{
      name: "validate",
      executable: tool,
      logsDir: path.join(logsDir, "validate"),
      args: [
        "-gproj", project,
        "-addonsDir", gameAddons,
        "-logsDir", path.join(logsDir, "validate"),
        "-wbSilent", "-wbModule=ScriptEditor", "-validate", "PC",
      ],
    }]);
  });

  it("runs validation separately before packing with distinct logs", () => {
    const options = parseWorkbenchArgs(["pack", "--project", project, "--output", output, "--execute"]);
    const steps = makeWorkbenchPlan(options, tool, logsDir, gameAddons);
    expect(options.execute).toBe(true);
    expect(steps.map((step) => step.name)).toEqual(["validate", "pack"]);
    expect(steps[0].args).toContain("-validate");
    expect(steps[1].args).toEqual([
      "-gproj", project,
      "-addonsDir", gameAddons,
      "-logsDir", path.join(logsDir, "pack"),
      "-wbModule=ResourceManager", "-packAddon", "-packAddonDir", output,
    ]);
  });

  it("rejects accidental or incomplete packing arguments", () => {
    expect(() => parseWorkbenchArgs(["pack", "--project", project])).toThrow("requires --output");
    expect(() => parseWorkbenchArgs(["validate", "--project", project, "--output", output])).toThrow("only valid for pack");
    expect(() => parseWorkbenchArgs(["pack", "--project", project, "--output", output, "--execute", "--execute"])).toThrow("twice");
    expect(() => parseWorkbenchArgs(["validate", "--project", project, "--configuration", "XBOX"])).toThrow("PC or ALL");
  });
});

describe("Workbench pack verification", () => {
  it("accepts a fresh success log and a fresh nonempty data.pak", () => {
    const { output, logs, startedAtMs } = createPackEvidence();
    expect(verifyPackResult(output, logs, startedAtMs)).toEqual([]);
  });

  it("rejects a zero-exit pack without an explicit success marker", () => {
    const { output, logs, startedAtMs } = createPackEvidence();
    writeFileSync(path.join(logs, "console.log"), "12:56:07.376  RESOURCES    : Packaging done. Result: 0\n");
    expect(verifyPackResult(output, logs, startedAtMs)).toEqual([
      expect.stringContaining("does not report"),
    ]);
  });

  it("rejects a leftover data.pak from an earlier run", () => {
    const { output, logs, startedAtMs } = createPackEvidence();
    const oldTime = new Date(startedAtMs - 60_000);
    utimesSync(path.join(output, "data.pak"), oldTime, oldTime);
    expect(verifyPackResult(output, logs, startedAtMs)).toEqual([
      expect.stringContaining("was not updated by this run"),
    ]);
  });

  it("rejects a stale success log or missing data.pak", () => {
    const { output, logs, startedAtMs } = createPackEvidence();
    const oldTime = new Date(startedAtMs - 60_000);
    utimesSync(path.join(logs, "console.log"), oldTime, oldTime);
    rmSync(path.join(output, "data.pak"));
    expect(verifyPackResult(output, logs, startedAtMs)).toEqual([
      expect.stringContaining("Pack log was not updated"),
      expect.stringContaining("data.pak is missing"),
    ]);
  });
});
