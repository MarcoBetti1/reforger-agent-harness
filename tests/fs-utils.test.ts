import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { globFiles, listFiles, searchText } from "../src/fs-utils.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("discovers addon text, excludes generated trees and honors result limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-discovery-")); roots.push(root);
  await mkdir(path.join(root, "Scripts")); await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "Scripts", "Probe.c"), "actual native fixture");
  await writeFile(path.join(root, "addon.gproj"), "project");
  await writeFile(path.join(root, "node_modules", "ignore.c"), "actual native fixture");
  const selected = [{ root, kind: "mod" as const }];
  const files = await listFiles(selected, "**/*");
  expect(files.map(f => path.relative(root, f.path)).sort()).toEqual([path.join("Scripts", "Probe.c"), "addon.gproj"].sort());
  expect(await listFiles(selected, "**/*", 1)).toHaveLength(1);
  expect(await searchText("native fixture", selected)).toEqual([expect.objectContaining({ line: 1, path: path.join(root, "Scripts", "Probe.c") })]);
  await expect(listFiles(selected, "../*")).rejects.toThrow("relative glob");
});

it("does not descend through linked addon directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-symlink-")); roots.push(root);
  const external = await mkdtemp(path.join(os.tmpdir(), "harness-outside-")); roots.push(external);
  await writeFile(path.join(external, "outside.pak"), "not selected");
  await symlink(external, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  const files = [];
  for await (const file of globFiles(root, "**/*.pak")) files.push(file);
  expect(files).toEqual([]);
});
