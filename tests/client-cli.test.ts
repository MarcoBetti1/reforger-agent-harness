import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classifyFatalClientLog, clientTimeLimitReached, enteredGameState, makeClientPlan, parseClientArgs, requireGameState, runClientCli, verifyInstalledAddons } from "../src/client-cli.js";

const ravenId = "6A3A112604EF7286";

describe("isolated client launcher", () => {
  it("accepts a caller-owned fresh run directory for reproducible logs", () => {
    const runDir = path.resolve(".cache", "convoy-tests", "runs", "manual-case");
    expect(parseClientArgs(["--run-dir", runDir]).runDir).toBe(runDir);
  });

  it("dry-runs a bounded windowed client from the game installation directory", () => {
    const options = parseClientArgs(["--profile", "isolated-profile", "--duration-seconds", "30"]);
    const executable = path.resolve("game", "ArmaReforgerSteam.exe");
    const plan = makeClientPlan(options, executable, path.resolve("run"));
    expect(options.execute).toBe(false);
    expect(plan.durationSeconds).toBe(30);
    expect(plan.keepOpen).toBe(false);
    expect(plan.cwd).toBe(path.dirname(executable));
    expect(plan.profile).toBe(path.resolve("isolated-profile"));
    expect(plan.args).toEqual([
      "-profile", path.resolve("isolated-profile"),
      "-logsDir", path.resolve("run", "logs"),
      "-addonDownloadDir", path.resolve("isolated-profile"),
      "-window", "-screenWidth", "1280", "-screenHeight", "720", "-maxFPS", "60", "-noSplash",
    ]);
  });

  it("keeps an explicitly requested player session open past the normal deadline", () => {
    const options = parseClientArgs(["--profile", "isolated-profile", "--keep-open"]);
    const executable = path.resolve("game", "ArmaReforgerSteam.exe");
    const plan = makeClientPlan(options, executable, path.resolve("run"));
    const bounded = makeClientPlan(parseClientArgs(["--profile", "isolated-profile"]), executable, path.resolve("run"));
    expect(plan.keepOpen).toBe(true);
    expect(plan.args).toEqual(bounded.args);
    expect(options.execute).toBe(false);
    expect(clientTimeLimitReached(false, 1_000, 1_000)).toBe(true);
    expect(clientTimeLimitReached(true, 1_000, 1_000_000)).toBe(false);
    expect(() => parseClientArgs(["--keep-open", "--duration-seconds", "30"])).toThrow("cannot be combined");
    expect(() => parseClientArgs(["--keep-open", "--keep-open"])).toThrow("provided twice");
  });

  it("keeps window placement and unfocused updates opt-in", () => {
    const options = parseClientArgs([]);
    const plan = makeClientPlan(options, path.resolve("game", "ArmaReforgerSteam.exe"), path.resolve("run"));
    expect(options.windowX).toBeUndefined();
    expect(options.windowY).toBeUndefined();
    expect(options.forceUpdate).toBe(false);
    expect(plan.args).not.toContain("-posX");
    expect(plan.args).not.toContain("-posY");
    expect(plan.args).not.toContain("-forceUpdate");
  });

  it("passes signed window coordinates and forceUpdate as separate launch arguments", () => {
    const options = parseClientArgs(["--window-x", "-1280", "--window-y", "0", "--force-update", "--world", "worlds/Test.ent"]);
    const executable = path.resolve("game", "ArmaReforgerSteam.exe");
    const baseline = makeClientPlan(parseClientArgs([]), executable, path.resolve("run"));
    const plan = makeClientPlan(options, executable, path.resolve("run"));
    expect(options).toMatchObject({ windowX: -1280, windowY: 0, forceUpdate: true, execute: false });
    expect(plan.args).toEqual([...baseline.args, "-posX", "-1280", "-posY", "0", "-forceUpdate", "-world", "worlds/Test.ent"]);
    expect(plan.cwd).toBe(baseline.cwd);
    expect(plan.profile).toBe(baseline.profile);
    expect(plan.durationSeconds).toBe(baseline.durationSeconds);
  });

  it.each([
    ["--window-x", "windowX", "-posX", "-posY"],
    ["--window-y", "windowY", "-posY", "-posX"],
  ])("accepts %s independently and preserves safe-integer boundaries", (flag, field, engineFlag, absentFlag) => {
    for (const value of [Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]) {
      const options = parseClientArgs([flag, String(value)]);
      const plan = makeClientPlan(options, path.resolve("game", "ArmaReforgerSteam.exe"), path.resolve("run"));
      expect(options[field as "windowX" | "windowY"]).toBe(value);
      expect(plan.args.slice(-2)).toEqual([engineFlag, String(value)]);
      expect(plan.args).not.toContain(absentFlag);
    }
  });

  it.each(["--window-x", "--window-y"])("rejects missing, duplicate and invalid %s coordinates", (flag) => {
    for (const value of ["NaN", "Infinity", "-Infinity", "1.5", "-1.5", "9007199254740992", "-9007199254740992", "1e3", "0x10", " ", "1px"]) {
      expect(() => parseClientArgs([flag, value])).toThrow("finite signed decimal safe integer");
    }
    expect(() => parseClientArgs([flag])).toThrow("Expected a value");
    expect(() => parseClientArgs([flag, "--force-update"])).toThrow("Expected a value");
    expect(() => parseClientArgs([flag, "1", flag, "2"])).toThrow("provided twice");
  });

  it("accepts forceUpdate without placement and rejects duplicate or assigned values", () => {
    const options = parseClientArgs(["--force-update"]);
    const plan = makeClientPlan(options, path.resolve("game", "ArmaReforgerSteam.exe"), path.resolve("run"));
    expect(plan.args.at(-1)).toBe("-forceUpdate");
    expect(plan.args).not.toContain("-posX");
    expect(plan.args).not.toContain("-posY");
    expect(() => parseClientArgs(["--force-update", "--force-update"])).toThrow("provided twice");
    expect(() => parseClientArgs(["--force-update", "false"])).toThrow("Unknown option");
  });

  it("reuses the same addon download cache across runs with a stable profile", () => {
    const options = parseClientArgs(["--profile", "isolated-profile"]);
    const executable = path.resolve("game", "ArmaReforgerSteam.exe");
    const first = makeClientPlan(options, executable, path.resolve("run-one"));
    const second = makeClientPlan(options, executable, path.resolve("run-two"));
    expect(first.downloadDir).toBe(path.resolve("isolated-profile"));
    expect(second.downloadDir).toBe(first.downloadDir);
    expect(second.logsDir).not.toBe(first.logsDir);
  });

  it("keeps GAME monitoring opt-in and leaves the dry-run command unchanged", () => {
    const defaultOptions = parseClientArgs(["--profile", "isolated-profile"]);
    const monitoredOptions = parseClientArgs(["--profile", "isolated-profile", "--expect-game"]);
    const executable = path.resolve("game", "ArmaReforgerSteam.exe");
    const defaultPlan = makeClientPlan(defaultOptions, executable, path.resolve("run"));
    const monitoredPlan = makeClientPlan(monitoredOptions, executable, path.resolve("run"));
    expect(defaultPlan.expectGame).toBe(false);
    expect(monitoredPlan.expectGame).toBe(true);
    expect(monitoredPlan.args).toEqual(defaultPlan.args);
    expect(monitoredOptions.execute).toBe(false);
    expect(() => parseClientArgs(["--expect-game", "--expect-game"])).toThrow("provided twice");
  });

  it("passes installed addon IDs and roots to the client", () => {
    const options = parseClientArgs([
      "--addon", ravenId.toLowerCase(),
      "--addons-dir", "cached-addons",
      "--world", "worlds/Test.ent",
    ]);
    const plan = makeClientPlan(options, path.resolve("game", "ArmaReforgerSteam.exe"), path.resolve("run"));
    expect(plan.args).toContain("-addonsDir");
    expect(plan.args).toContain(path.resolve("cached-addons"));
    expect(plan.args).toContain("-addons");
    expect(plan.args).toContain(ravenId);
    expect(plan.args.slice(-2)).toEqual(["-world", "worlds/Test.ent"]);
  });

  it("uses only the documented IP-only local connection syntax", () => {
    const options = parseClientArgs(["--connect-local"]);
    const plan = makeClientPlan(options, path.resolve("game", "ArmaReforgerSteam.exe"), path.resolve("run"));
    expect(plan.args.slice(-2)).toEqual(["-client", "127.0.0.1"]);
    expect(() => parseClientArgs(["--connect-local", "--world", "worlds/Test.ent"])).toThrow("cannot be combined");
    expect(() => parseClientArgs(["--connect-local", "25523"])).toThrow("Unknown option");
  });

  it("rejects unsafe or malformed options before launch", () => {
    expect(() => parseClientArgs(["--addon", ravenId])).toThrow("--addons-dir or --profile");
    expect(() => parseClientArgs(["--duration-seconds", "0"])).toThrow("--duration-seconds");
    expect(() => parseClientArgs(["--duration-seconds", "7201"])).toThrow("--duration-seconds");
    expect(() => parseClientArgs(["--addon", "invalid", "--addons-dir", "cache"])).toThrow("Invalid addon ID");
    expect(() => parseClientArgs(["--world", "Missions/Test.conf"])).toThrow(".ent world");
    expect(() => parseClientArgs(["--profile", path.join(os.homedir(), "Documents", "My Games", "ArmaReforger")])).toThrow("normal ArmaReforger profile");
  });

  it("checks that selected addon IDs actually exist in an installed addon root", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "reforger-client-test-"));
    try {
      const addon = path.join(root, `RavenAICommander_${ravenId}`);
      mkdirSync(addon);
      writeFileSync(path.join(addon, "addon.gproj"), `GameProject {\n GUID "${ravenId}"\n}`);
      writeFileSync(path.join(addon, "data.pak"), "test fixture");
      writeFileSync(path.join(addon, "resourceDatabase.rdb"), "test resource identities");
      expect(() => verifyInstalledAddons([ravenId], [root])).not.toThrow();
      expect(() => verifyInstalledAddons(["AAAAAAAAAAAAAAAA"], [root])).toThrow("was not found");
      expect(() => verifyInstalledAddons([ravenId], [path.join(root, "missing")])).toThrow("does not exist");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["missing", "empty", "directory"])("rejects a selected packed addon with a %s resource database", (kind) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "reforger-client-pack-test-"));
    try {
      // Local pack folders can have an arbitrary name; their gproj selects the GUID.
      const addon = path.join(root, "LocalPack");
      mkdirSync(addon);
      writeFileSync(path.join(addon, "addon.gproj"), `GameProject {\n GUID "${ravenId}"\n}`);
      writeFileSync(path.join(addon, "data.pak"), "test fixture");
      const database = path.join(addon, "resourceDatabase.rdb");
      if (kind === "empty") writeFileSync(database, "");
      if (kind === "directory") mkdirSync(database);
      expect(() => verifyInstalledAddons([ravenId], [root])).toThrow(`resourceDatabase.rdb: ${database}`);
      expect(() => verifyInstalledAddons([ravenId], [root])).toThrow("same completed pack");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves source-only projects and ignores unselected incomplete packs", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "reforger-client-source-test-"));
    try {
      const source = path.join(root, "SourceProject");
      const unrelated = path.join(root, "UnselectedPack");
      mkdirSync(source);
      mkdirSync(unrelated);
      writeFileSync(path.join(source, "addon.gproj"), `GameProject {\n GUID "${ravenId}"\n}`);
      writeFileSync(path.join(unrelated, "addon.gproj"), 'GameProject { GUID "AAAAAAAAAAAAAAAA" }');
      writeFileSync(path.join(unrelated, "data.pak"), "unselected fixture");
      expect(() => verifyInstalledAddons([ravenId], [root])).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an incomplete selected pack before executable discovery or launch", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "reforger-client-preflight-test-"));
    try {
      const addon = path.join(root, `Example_${ravenId}`);
      mkdirSync(addon);
      writeFileSync(path.join(addon, "addon.gproj"), `GameProject {\n GUID "${ravenId}"\n}`);
      writeFileSync(path.join(addon, "data.pak"), "test fixture");
      await expect(runClientCli([
        "--addon", ravenId, "--addons-dir", root,
        "--game", path.join(root, "does-not-exist.exe"), "--execute",
      ])).rejects.toThrow("resourceDatabase.rdb");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies fatal startup and local connection messages without treating ordinary log lines as failures", () => {
    expect(classifyFatalClientLog("12:44:46.340 RPL       (E): ClientImpl event: handshake timeout (identity=0x00000000)", true)).toBe("RPL handshake timeout");
    expect(classifyFatalClientLog("12:44:46.340 NETWORK   (E): Unable to connect as client to '127.0.0.1'", true)).toBe("Unable to connect as client");
    expect(classifyFatalClientLog("12:44:46.555 ENGINE    (E): Unable to initialize the game", false)).toBe("Unable to initialize the game");
    expect(classifyFatalClientLog("12:44:15.899 NETWORK      : Starting multiplayer client using command line args.", true)).toBeUndefined();
    expect(classifyFatalClientLog("12:44:46.340 NETWORK   (E): Unable to connect as client to '127.0.0.1'", false)).toBeUndefined();
  });

  it("recognizes the real GAME state transition but not preliminary startup or other states", () => {
    const startup = [
      "13:15:55.391 ENGINE       : Game successfully created.",
      "13:16:02.114 DEFAULT      : Entered offline game state.",
      "13:16:02.250 SCRIPT       : SCR_BaseGameMode::OnGameStateChanged = PREPARE",
    ].join("\n");
    const transition = "13:16:02.250   SCRIPT       : SCR_BaseGameMode::OnGameStateChanged = GAME\n";
    expect(enteredGameState(startup)).toBe(false);
    expect(enteredGameState(`${startup}\n${transition}`)).toBe(true);
    expect(enteredGameState("SCR_BaseGameMode::OnGameStateChanged = GAME_OVER")).toBe(false);
  });

  it("fails an expected GAME run that never reaches gameplay and names its log", () => {
    const log = path.resolve("run", "logs", "console.log");
    expect(() => requireGameState(true, false, log)).toThrow(`Client did not reach GAME state before the run ended. Log: ${log}`);
    expect(() => requireGameState(true, true, log)).not.toThrow();
    expect(() => requireGameState(false, false, log)).not.toThrow();
  });
});
