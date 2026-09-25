import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareKnowledge } from "../src/knowledge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reforger-knowledge-"));
  tempDirs.push(dir);
  return dir;
}

async function makeApiHtmlRoot(parent: string, folder: string): Promise<string> {
  const htmlRoot = path.join(parent, folder, "html");
  await mkdir(htmlRoot, { recursive: true });
  await writeFile(path.join(htmlRoot, "classes.html"), "API docs");
  return htmlRoot;
}

describe("knowledge preparation", () => {
  it("prefers installed Workbench HTML docs and reuses current web snapshots", async () => {
    const dir = await makeTempDir();
    const library = path.join(dir, "SteamLibrary");
    const toolsDocs = path.join(library, "steamapps", "common", "Arma Reforger Tools", "Workbench", "docs");
    const reforgerDocs = await makeApiHtmlRoot(toolsDocs, "ArmaReforgerScriptAPIPublic");
    const enfusionDocs = await makeApiHtmlRoot(toolsDocs, "EnfusionScriptAPI");
    const cachedDocs = path.join(dir, ".cache", "knowledge", "offline-api");
    await makeApiHtmlRoot(cachedDocs, "ArmaReforgerScriptAPIPublic");
    await makeApiHtmlRoot(cachedDocs, "EnfusionScriptAPIPublic");
    const webRoot = path.join(dir, ".cache", "knowledge", "official-web");
    await mkdir(webRoot, { recursive: true });
    await writeFile(path.join(webRoot, "tools-workbench-plugin.html"), "cached page");
    const options = {
      docRoots: [cachedDocs],
      steamLibraries: [library],
      webSources: [{ category: "tools", title: "Workbench Plugin", url: "https://example.invalid" }],
      fetchPage: async () => { throw new Error("fetch should not run"); },
    };

    const first = await prepareKnowledge(dir, false, options);
    const firstManifest = await readFile(first.manifestPath, "utf8");
    const firstMtime = (await stat(first.manifestPath)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await prepareKnowledge(dir, false, options);

    expect(first.extractedApiRoots).toEqual([reforgerDocs, enfusionDocs]);
    expect(second.extractedApiRoots).toEqual(first.extractedApiRoots);
    expect(await readFile(first.manifestPath, "utf8")).toBe(firstManifest);
    expect((await stat(first.manifestPath)).mtimeMs).toBe(firstMtime);
  });

  it("falls back to cached API docs when Tools docs are unavailable", async () => {
    const dir = await makeTempDir();
    const cachedDocs = path.join(dir, ".cache", "knowledge", "offline-api");
    const reforgerDocs = await makeApiHtmlRoot(cachedDocs, "ArmaReforgerScriptAPIPublic");
    const enfusionDocs = await makeApiHtmlRoot(cachedDocs, "EnfusionScriptAPIPublic");

    const report = await prepareKnowledge(dir, false, {
      docRoots: [],
      steamLibraries: [],
      webSources: [],
    });

    expect(report.extractedApiRoots).toEqual([reforgerDocs, enfusionDocs]);
  });

  it("accepts configured API directories without a Steam library index", async () => {
    const dir = await makeTempDir();
    const docs = path.join(dir, "Workbench", "docs");
    const reforgerDocs = await makeApiHtmlRoot(docs, "ArmaReforgerScriptAPIPublic");
    const enfusionDocs = await makeApiHtmlRoot(docs, "EnfusionScriptAPI");

    const report = await prepareKnowledge(dir, false, {
      docRoots: [path.dirname(reforgerDocs), path.dirname(enfusionDocs)],
      steamLibraries: [],
      webSources: [],
    });

    expect(report.extractedApiRoots).toEqual([reforgerDocs, enfusionDocs]);
  });
});
