import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeWorkbenchOpenPlan,
  parseWorkbenchOpenArgs,
  runWorkbenchOpenCli,
  type WorkbenchOpenOptions,
} from "../src/workbench-open.js";

const tempRoots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function options(editor: WorkbenchOpenOptions["editor"], world?: string): WorkbenchOpenOptions {
  return {
    editor,
    project: path.resolve("project", "addon.gproj"),
    world,
    authorizeLocalTestScripts: false,
    execute: false,
  };
}

describe("Workbench GUI opener", () => {
  it("defaults to a dry-run Resource Manager launch", () => {
    const parsed = parseWorkbenchOpenArgs([]);
    expect(parsed.editor).toBe("resource");
    expect(parsed.execute).toBe(false);
    expect(parsed.project).toMatch(/addon\.gproj$/i);

    const plan = makeWorkbenchOpenPlan(options("resource"), "Workbench.exe", "game-addons", "logs");
    expect(plan.args).toEqual([
      "-gproj", path.resolve("project", "addon.gproj"),
      "-addonsDir", "game-addons",
      "-logsDir", "logs",
      "-wbModule=ResourceManager", "-run",
    ]);
  });

  it("selects Script Editor without loading a resource", () => {
    const parsed = parseWorkbenchOpenArgs(["--editor", "script", "--execute"]);
    expect(parsed.editor).toBe("script");
    expect(parsed.execute).toBe(true);
    expect(makeWorkbenchOpenPlan(parsed, "Workbench.exe", "game-addons", "logs").args).toContain("-wbModule=ScriptEditor");
    expect(makeWorkbenchOpenPlan(parsed, "Workbench.exe", "game-addons", "logs").args).not.toContain("-load");
  });

  it("passes an optional .ent resource after World Editor -run", () => {
    const parsed = parseWorkbenchOpenArgs(["--editor", "world", "--world", "worlds/GameMaster/GM_Arland.ent"]);
    const plan = makeWorkbenchOpenPlan(parsed, "Workbench.exe", "game-addons", "logs");
    expect(plan.args.slice(-4)).toEqual(["-wbModule=WorldEditor", "-run", "-load", "worlds/GameMaster/GM_Arland.ent"]);
    expect(makeWorkbenchOpenPlan(options("world"), "Workbench.exe", "game-addons", "logs").args.slice(-2)).toEqual(["-wbModule=WorldEditor", "-run"]);
  });

  it("opts into local test script authorization for one launched Workbench process", () => {
    const parsed = parseWorkbenchOpenArgs([
      "--editor", "world", "--world", "Worlds/Tests/ExampleScenario.ent",
      "--authorize-local-test-scripts",
    ]);
    const plan = makeWorkbenchOpenPlan(parsed, "Workbench.exe", "game-addons", "logs");
    expect(plan.args).toContain("-scriptAuthorizeAll");
    expect(makeWorkbenchOpenPlan(options("world"), "Workbench.exe", "game-addons", "logs").args)
      .not.toContain("-scriptAuthorizeAll");
    expect(() => parseWorkbenchOpenArgs([
      "--authorize-local-test-scripts", "--authorize-local-test-scripts",
    ])).toThrow("provided twice");
  });

  it("rejects ambiguous editor and world arguments", () => {
    expect(() => parseWorkbenchOpenArgs(["--editor", "wrong"])).toThrow("--editor must be");
    expect(() => parseWorkbenchOpenArgs(["--world", "world.ent"])).toThrow("--world requires");
    expect(() => parseWorkbenchOpenArgs(["--editor", "world", "--world", "not-a-world.txt"])).toThrow(".ent resource");
    expect(() => parseWorkbenchOpenArgs(["--execute", "--execute"])).toThrow("provided twice");
  });

  it("does not create a log directory or launch a process in dry-run mode", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "workbench-open-"));
    tempRoots.push(root);
    const project = path.join(root, "addon.gproj");
    const tool = path.join(root, "Workbench.exe");
    const gameAddons = path.join(root, "game-addons");
    const logs = path.join(root, "logs");
    writeFileSync(project, "");
    writeFileSync(tool, "");
    mkdirSync(gameAddons);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    expect(await runWorkbenchOpenCli([
      "--project", project,
      "--tool", tool,
      "--game-addons", gameAddons,
      "--logs-dir", logs,
    ])).toBe(0);
    expect(existsSync(logs)).toBe(false);
    expect(output.mock.calls.map((call) => String(call[0])).join("")).toContain("Dry run only");
  });
});
