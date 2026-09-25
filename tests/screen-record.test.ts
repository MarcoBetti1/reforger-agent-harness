import { describe, expect, it } from "vitest";

import { parseRecordArgs, recordCommand } from "../src/screen-record-cli.js";

describe("screen video recorder", () => {
  it("builds an opt-in Desktop Duplication command for a selected monitor", () => {
    const options = parseRecordArgs([
      "--backend", "ddagrab", "--output-idx", "1", "--fps", "8",
      "--duration-seconds", "3", "--output", ".cache/test-videos/test.mp4",
    ]);
    const command = recordCommand(options);
    expect(command).toContain("ddagrab=output_idx=1:framerate=8");
    expect(command).toContain("hwdownload,format=bgra,format=yuv420p");
    expect(command).not.toContain("gdigrab");
  });

  it("requires an explicit monitor index and separates whole-monitor from window capture", () => {
    expect(() => parseRecordArgs(["--backend", "ddagrab", "--output", "test.mp4"]))
      .toThrow("--output-idx");
    expect(() => parseRecordArgs(["--backend", "ddagrab", "--output-idx", "1", "--window-title", "Workbench", "--output", "test.mp4"]))
      .toThrow("omit --window-title");
    const window = parseRecordArgs(["--window-title", "Workbench", "--output", "test.mp4"]);
    expect(recordCommand(window)).toContain("gdigrab");
  });
});
