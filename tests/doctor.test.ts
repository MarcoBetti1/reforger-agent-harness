import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findWorkshopMods, runDoctor } from "../src/doctor.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reforger-doctor-"));
  tempDirs.push(dir);
  return dir;
}

describe("doctor", () => {
  it("finds game and Workbench through Steam libraryfolders.vdf and reports absent roots", async () => {
    const dir = await makeTempDir();
    const steamRoot = path.join(dir, "Steam");
    const gameLibrary = path.join(dir, "Game Library");
    const modRoot = path.join(dir, "addons");
    const gameExe = path.join(gameLibrary, "steamapps", "common", "Arma Reforger", "ArmaReforgerSteam.exe");
    const workbenchExe = path.join(
      gameLibrary,
      "steamapps",
      "common",
      "Arma Reforger Tools",
      "Workbench",
      "ArmaReforgerWorkbenchSteamDiag.exe",
    );
    await mkdir(path.dirname(gameExe), { recursive: true });
    await mkdir(path.dirname(workbenchExe), { recursive: true });
    await mkdir(path.join(steamRoot, "steamapps"), { recursive: true });
    await mkdir(modRoot);
    await writeFile(gameExe, "");
    await writeFile(workbenchExe, "");
    const escapedLibrary = gameLibrary.replace(/\\/g, "\\\\");
    await writeFile(
      path.join(steamRoot, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders" { "0" { "path" "${escapedLibrary}" } }`,
    );

    const report = await runDoctor(
      { modRoots: [modRoot], docRoots: [path.join(dir, "missing-docs")], sampleRoots: [] },
      [],
      { steamRoots: [steamRoot], steamLibraries: [], executableOverrides: {} },
    );

    expect(report.roots.map((root) => root.exists)).toEqual([true, false]);
    expect(report.steamLibraries).toContain(path.resolve(gameLibrary));
    expect(report.executables.game.path).toBe(gameExe);
    expect(report.executables.workbench.path).toBe(workbenchExe);
    expect(report.executables.server.path).toBeUndefined();
  });

  it("honors an explicit executable override and reports an invalid override", async () => {
    const dir = await makeTempDir();
    const serverExe = path.join(dir, "server.exe");
    await writeFile(serverExe, "");

    const report = await runDoctor(
      { modRoots: [], docRoots: [], sampleRoots: [] },
      [],
      {
        steamRoots: [],
        steamLibraries: [],
        executableOverrides: {
          game: path.join(dir, "missing.exe"),
          server: serverExe,
        },
      },
    );

    expect(report.executables.game.invalidOverride).toBe(true);
    expect(report.executables.server).toEqual({ path: serverExe, source: "override" });
  });

  it("matches exact Workshop IDs in immediate addon folders and checks package presence", async () => {
    const dir = await makeTempDir();
    const root = path.join(dir, "addons");
    const id = "6A3A112604EF7286";
    const packaged = path.join(root, `Raven_${id}`);
    const unpackaged = path.join(root, `Copy_${id}`);
    await mkdir(packaged, { recursive: true });
    await mkdir(unpackaged);
    await mkdir(path.join(root, `NotAMatch_${id}0`));
    await writeFile(path.join(packaged, "data.pak"), "");

    const [found, absent] = await findWorkshopMods([id.toLowerCase(), "AAAAAAAAAAAAAAAA"], [root]);

    expect(found.id).toBe(id);
    expect(found.folders).toHaveLength(2);
    expect(found.folders).toEqual(
      expect.arrayContaining([
        { path: unpackaged, packaged: false },
        { path: packaged, packaged: true },
      ]),
    );
    expect(absent.folders).toEqual([]);
    await expect(findWorkshopMods(["bad-id"], [root])).rejects.toThrow("Invalid Workshop mod ID");
  });
});
