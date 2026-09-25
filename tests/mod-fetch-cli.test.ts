import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { inspectFetchedMods, parseModFetchArgs, runModFetchCli } from "../src/mod-fetch-cli.js";
import { makeLocalServerConfig } from "../src/server-config-cli.js";

const ravenId = "6A3A112604EF7286";
const heliId = "D6B177DBEE89E8C4";
const scenario = "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf";

async function withTempProfile(action: (profile: string) => Promise<void>): Promise<void> {
  const profile = await mkdtemp(path.join(os.tmpdir(), "reforger-fetch-test-"));
  try {
    await action(profile);
  } finally {
    if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith("reforger-fetch-test-")) {
      throw new Error("Refusing to remove an unexpected test profile path.");
    }
    await rm(profile, { recursive: true, force: true });
  }
}

async function addFolder(profile: string, folderName: string, guid: string, pack?: string): Promise<string> {
  const folder = path.join(profile, "addons", folderName);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "addon.gproj"), `GameProject { GUID "${guid}" }`);
  if (pack !== undefined) await writeFile(path.join(folder, "data.pak"), pack);
  return folder;
}

describe("Workshop mod fetcher", () => {
  it("uses an isolated cache and private server config, with dry run as the default", () => {
    const options = parseModFetchArgs(["--mod", `${ravenId.toLowerCase()}=Raven AI Commander`, "--mod", heliId]);
    const config = makeLocalServerConfig(scenario, options.modValues, options.port);
    expect(options.execute).toBe(false);
    expect(options.profile).toBe(path.resolve(".cache", "workshop-fetch", "profile"));
    expect(options.durationSeconds).toBe(120);
    expect(config.bindAddress).toBe("127.0.0.1");
    expect(config.publicAddress).toBe("127.0.0.1");
    expect(config.game.visible).toBe(false);
    expect(config.game.mods).toEqual([
      { modId: ravenId, name: "Raven AI Commander", required: true },
      { modId: heliId, name: heliId, required: true },
    ]);
  });

  it("rejects invalid IDs, duplicates, unsafe profiles and unbounded values", () => {
    expect(() => parseModFetchArgs([])).toThrow("At least one --mod");
    expect(() => parseModFetchArgs(["--mod", "bad"])).toThrow("Invalid Workshop mod ID");
    expect(() => parseModFetchArgs(["--mod", ravenId, "--mod", ravenId.toLowerCase()])).toThrow("Duplicate");
    expect(() => parseModFetchArgs(["--mod", ravenId, "--duration-seconds", "3601"])).toThrow("--duration-seconds");
    expect(() => parseModFetchArgs(["--mod", ravenId, "--profile", path.join(os.homedir(), "Documents", "My Games", "ArmaReforger", "profile")])).toThrow("isolated");
  });

  it("requires a matching addon.gproj GUID and nonempty data.pak", async () => {
    await withTempProfile(async (profile) => {
      const mods = makeLocalServerConfig(scenario, [ravenId, heliId], 25531).game.mods;
      await addFolder(profile, `Pretender_${ravenId}`, heliId, "packed");
      const emptyFolder = await addFolder(profile, "ActualRaven", ravenId, "");
      let statuses = await inspectFetchedMods(mods, profile);
      expect(statuses.find((mod) => mod.id === ravenId)?.folder).toBeUndefined();
      expect(statuses.find((mod) => mod.id === heliId)?.folder).toContain("Pretender_");

      await writeFile(path.join(emptyFolder, "data.pak"), "packed");
      statuses = await inspectFetchedMods(mods, profile);
      expect(statuses.find((mod) => mod.id === ravenId)).toMatchObject({ folder: emptyFolder, dataPakBytes: 6 });
    });
  });

  it("does not launch a server on dry run or when every requested addon is cached", async () => {
    await withTempProfile(async (profile) => {
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        expect(await runModFetchCli(["--mod", ravenId, "--profile", profile])).toBe(0);
        expect(stdout.mock.calls.map((call) => String(call[0])).join("")).toContain("Dry run only");
        stdout.mockClear();

        await addFolder(profile, "Raven", ravenId, "packed");
        expect(await runModFetchCli(["--mod", ravenId, "--profile", profile, "--execute", "--server", "missing.exe"])).toBe(0);
        expect(stdout.mock.calls.map((call) => String(call[0])).join("")).toContain("no server run needed");
      } finally {
        stdout.mockRestore();
      }
    });
  });
});
