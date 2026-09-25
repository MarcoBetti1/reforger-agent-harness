import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CONFLICT_ARLAND_SCENARIO,
  makeConflictHostServerArgs,
  parseConflictHostArgs,
  runConflictHostCli,
} from "../src/conflict-host-cli.js";
import { makeLocalServerPlan, parseLocalServerArgs, validateLocalServerConfig } from "../src/local-server-cli.js";
import { makeLocalServerConfig } from "../src/server-config-cli.js";

const raven = "6A3A112604EF7286=Raven AI Commander";
const second = "B52C5F6AEDBF423E=AI Conflict Arland";

describe("single-command Conflict host", () => {
  it("builds a hidden, loopback-only Conflict Arland config for multiple requested mods", () => {
    const options = parseConflictHostArgs(["--mod", raven, "--mod", second]);
    expect(options).toMatchObject({ execute: false, port: 2001, durationSeconds: 3600, startupTimeoutSeconds: 600 });
    const config = makeLocalServerConfig(CONFLICT_ARLAND_SCENARIO, options.modValues, options.port);
    expect(() => validateLocalServerConfig(config)).not.toThrow();
    expect(config.game.scenarioId).toBe("{C41618FD18E9D714}Missions/23_Campaign_Arland.conf");
    expect(config.game.mods).toEqual([
      { modId: "6A3A112604EF7286", name: "Raven AI Commander", required: true },
      { modId: "B52C5F6AEDBF423E", name: "AI Conflict Arland", required: true },
    ]);
  });

  it("passes execution only to the guarded runner with a reusable isolated profile and bounded play time", () => {
    const options = parseConflictHostArgs([
      "--mod", raven,
      "--port", "25531",
      "--duration-seconds", "1800",
      "--startup-timeout-seconds", "120",
      "--server", "custom-server.exe",
      "--execute",
    ]);
    const configPath = path.resolve(".cache/conflict-host/test/server.json");
    const guarded = parseLocalServerArgs(makeConflictHostServerArgs(options, configPath));
    expect(guarded).toMatchObject({
      config: configPath,
      profile: path.resolve(".cache/workshop-fetch/profile"),
      durationSeconds: 1800,
      startupTimeoutSeconds: 120,
      execute: true,
    });
    const plan = makeLocalServerPlan(guarded, path.resolve("custom-server.exe"), path.resolve("run"));
    expect(plan.args).toContain("-config");
    expect(plan.args).not.toContain("-server");
    expect(plan.profile).toBe(path.resolve(".cache/workshop-fetch/profile"));
  });

  it("rejects missing or ambiguous mod and duration inputs before any launch", () => {
    expect(() => parseConflictHostArgs([])).toThrow("At least one --mod");
    expect(() => parseConflictHostArgs(["--mod", "bad"])).toThrow("Invalid Workshop mod ID");
    expect(() => parseConflictHostArgs(["--mod", raven, "--mod", "6a3a112604ef7286=Again"])).toThrow("Duplicate Workshop mod IDs");
    expect(() => parseConflictHostArgs(["--mod", raven, "--duration-seconds", "3601"])).toThrow("--duration-seconds");
    expect(() => parseConflictHostArgs(["--mod", raven, "--port", "80"])).toThrow("--port");
    expect(() => parseConflictHostArgs(["--mod", raven, "--execute", "--execute"])).toThrow("twice");
    expect(() => parseConflictHostArgs(["--mod", raven, "--keep-open", "--duration-seconds", "30"])).toThrow("either");
    expect(() => parseConflictHostArgs(["--mod", raven, "--scenario", "Arland"])).toThrow("--scenario");
  });

  it("accepts an explicit scenario for a mod that targets another Conflict map", () => {
    const scenarioId = "{1234567890ABCDEF}Missions/Custom_Conflict.conf";
    const options = parseConflictHostArgs(["--mod", raven, "--scenario", scenarioId]);
    const config = makeLocalServerConfig(options.scenarioId, options.modValues, options.port);
    expect(config.game.scenarioId).toBe(scenarioId);
    expect(config.game.visible).toBe(false);
    expect(config.bindAddress).toBe("127.0.0.1");
  });

  it("leaves the guarded host running for a player when keep-open is explicit", () => {
    const options = parseConflictHostArgs(["--mod", raven, "--keep-open", "--execute"]);
    const configPath = path.resolve(".cache/conflict-host/test/server.json");
    const guarded = parseLocalServerArgs(makeConflictHostServerArgs(options, configPath));
    expect(guarded.execute).toBe(true);
    expect(guarded.durationSeconds).toBeUndefined();
    expect(guarded.profile).toBe(path.resolve(".cache/workshop-fetch/profile"));
  });

  it("dry-runs without launching and prints the local join caveat", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await runConflictHostCli(["--mod", raven])).toBe(0);
      const lines = output.mock.calls.map(([value]) => String(value)).join("");
      expect(lines).toContain("Private host: 127.0.0.1:2001, hidden");
      expect(lines).toContain("Dry run only");
      expect(lines).toContain("earlier automatic local joins timed out");
    } finally {
      output.mockRestore();
    }
  });
});
