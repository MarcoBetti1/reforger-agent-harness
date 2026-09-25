import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  makeLocalServerPlan,
  parseLocalServerArgs,
  parseUdpEndpoints,
  unsafeUdpEndpoints,
  validateLocalServerConfig,
} from "../src/local-server-cli.js";

const scenarioId = "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf";

function privateConfig(): Record<string, unknown> {
  return {
    bindAddress: "127.0.0.1",
    bindPort: 25523,
    publicAddress: "127.0.0.1",
    publicPort: 25523,
    game: { name: "Local Raven test", scenarioId, visible: false, mods: [] },
  };
}

describe("guarded local server launcher", () => {
  it("dry-runs a private config with -config, a distinct profile and logs, and 60 FPS", () => {
    const options = parseLocalServerArgs(["--config", "server.json", "--duration-seconds", "30"]);
    expect(options.execute).toBe(false);
    expect(options.durationSeconds).toBe(30);
    const plan = makeLocalServerPlan(options, path.resolve("ArmaReforgerServer.exe"), path.resolve("run"));
    expect(plan.args).toEqual([
      "-config", path.resolve("server.json"),
      "-profile", path.resolve("run", "profile"),
      "-logsDir", path.resolve("run", "logs"),
      "-maxFPS", "60",
    ]);
    expect(plan.args).not.toContain("-server");
  });

  it("rejects incomplete CLI options and out-of-bounds timeouts", () => {
    expect(() => parseLocalServerArgs([])).toThrow("Missing --config");
    expect(() => parseLocalServerArgs(["--config", "a", "--execute", "--execute"])).toThrow("twice");
    expect(() => parseLocalServerArgs(["--config", "a", "--duration-seconds", "0"])).toThrow("--duration-seconds");
    expect(() => parseLocalServerArgs(["--config", "a", "--startup-timeout-seconds", "1"])).toThrow("--startup-timeout-seconds");
  });

  it("accepts a loopback-only hidden server, including loopback a2s and rcon endpoints", () => {
    const config = privateConfig();
    config.a2s = { address: "127.0.0.1", port: 25524 };
    config.rcon = { address: "127.0.0.1", port: 25525 };
    expect(() => validateLocalServerConfig(config)).not.toThrow();
  });

  it("rejects any public network setting before launch", () => {
    for (const [field, value] of [
      ["bindAddress", "0.0.0.0"],
      ["publicAddress", "192.168.1.10"],
    ] as const) {
      const config = privateConfig();
      config[field] = value;
      expect(() => validateLocalServerConfig(config)).toThrow(field);
    }
    const visible = privateConfig();
    (visible.game as Record<string, unknown>).visible = true;
    expect(() => validateLocalServerConfig(visible)).toThrow("game.visible");
    const a2s = privateConfig();
    a2s.a2s = { address: "0.0.0.0", port: 25524 };
    expect(() => validateLocalServerConfig(a2s)).toThrow("a2s.address");
    const rcon = privateConfig();
    rcon.rcon = { address: "192.168.1.10", port: 25525 };
    expect(() => validateLocalServerConfig(rcon)).toThrow("rcon.address");
    const legacy = privateConfig();
    legacy.gameHostBindAddress = "0.0.0.0";
    expect(() => validateLocalServerConfig(legacy)).toThrow("legacy network setting");
  });

  it("fails closed on wildcard or public UDP endpoints observed after spawn", () => {
    expect(parseUdpEndpoints('[{"LocalAddress":"127.0.0.1","LocalPort":25523}]')).toEqual([
      { LocalAddress: "127.0.0.1", LocalPort: 25523 },
    ]);
    expect(unsafeUdpEndpoints(parseUdpEndpoints("[]"))).toEqual([]);
    expect(unsafeUdpEndpoints(parseUdpEndpoints('[{"LocalAddress":"127.0.0.1","LocalPort":25523},{"LocalAddress":"0.0.0.0","LocalPort":2001}]'))).toEqual([
      { LocalAddress: "0.0.0.0", LocalPort: 2001 },
    ]);
    expect(unsafeUdpEndpoints([{ LocalAddress: "192.168.1.10", LocalPort: 2001 }])).toHaveLength(1);
    expect(() => parseUdpEndpoints('{"unexpected":true}')).toThrow("Could not parse");
  });
});
