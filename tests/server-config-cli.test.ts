import { describe, expect, it } from "vitest";

import { makeLocalServerConfig } from "../src/server-config-cli.js";

describe("local server config", () => {
  it("keeps a Workshop test private and preserves the exact scenario and mod IDs", () => {
    const config = makeLocalServerConfig(
      "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf",
      ["6a3a112604ef7286=Raven AI Commander"],
      25001,
    );

    expect(config.bindAddress).toBe("127.0.0.1");
    expect(config.publicAddress).toBe("127.0.0.1");
    expect(config.game.visible).toBe(false);
    expect(config.game.scenarioId).toBe("{C41618FD18E9D714}Missions/23_Campaign_Arland.conf");
    expect(config.game.mods).toEqual([
      { modId: "6A3A112604EF7286", name: "Raven AI Commander", required: true },
    ]);
  });

  it("rejects ambiguous or invalid setup inputs", () => {
    const scenario = "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf";
    expect(() => makeLocalServerConfig("Arland", [], 2001)).toThrow(/scenario/);
    expect(() => makeLocalServerConfig(scenario, [], 80)).toThrow(/port/);
    expect(() => makeLocalServerConfig(scenario, ["bad"], 2001)).toThrow(/mod ID/);
    expect(() => makeLocalServerConfig(scenario, ["6A3A112604EF7286", "6a3a112604ef7286"], 2001)).toThrow(/Duplicate/);
  });
});
