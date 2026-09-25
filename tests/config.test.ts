import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, resolveConfigPath } from "../src/config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("config loading", () => {
  it("resolves the default config path from cwd", () => {
    expect(resolveConfigPath("C:\\repo")).toBe(path.resolve("C:\\repo", "reforger-agent.config.json"));
  });

  it("loads and normalizes configured roots", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "reforger-agent-"));
    tempDirs.push(dir);

    await writeFile(
      path.join(dir, "reforger-agent.config.json"),
      JSON.stringify(
        {
          modRoots: ["mods"],
          docRoots: ["docs"],
          sampleRoots: ["samples"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await loadConfig(dir);

    expect(loaded.config.modRoots).toEqual([path.resolve(dir, "mods")]);
    expect(loaded.config.docRoots).toEqual([path.resolve(dir, "docs")]);
    expect(loaded.config.sampleRoots).toEqual([path.resolve(dir, "samples")]);
  });
});
