import { describe, expect, it } from "vitest";

import { extractAssetPathsFromBuffer } from "../src/package-inspector.js";

describe("package inspector", () => {
  it("extracts asset-like paths from binary content", () => {
    const buffer = Buffer.from(
      [
        "junk",
        "{ABCC1FF0D6096E47}Prefabs/Vehicles/Tracked/BFV/M2A2_BASE.et",
        "Assets/Vehicles/Tracked/BFV/data/BODY.emat",
      ].join("\u0000"),
      "latin1",
    );

    expect(extractAssetPathsFromBuffer(buffer, 10)).toEqual([
      "{ABCC1FF0D6096E47}Prefabs/Vehicles/Tracked/BFV/M2A2_BASE.et",
      "Assets/Vehicles/Tracked/BFV/data/BODY.emat",
    ]);
  });
});
