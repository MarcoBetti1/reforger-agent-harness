import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatLogSummary, parseLogSummaryArgs, summarizeReforgerLog } from "../src/log-summary-cli.js";

const logPath = path.resolve("run", "logs", "console.log");

describe("Reforger log summary", () => {
  it("requires an explicit log path and accepts optional JSON output", () => {
    expect(parseLogSummaryArgs(["--log", logPath, "--json"])).toEqual({ logPath, json: true });
    expect(() => parseLogSummaryArgs([])).toThrow("explicit --log");
    expect(() => parseLogSummaryArgs(["--log"])).toThrow("Expected a path");
    expect(() => parseLogSummaryArgs(["--log", logPath, "--log", logPath])).toThrow("provided twice");
  });

  it("reports the latest loaded block and mission, GAME, Raven startup, and supply activity separately", () => {
    const log = [
      "ENGINE       : Available addons:",
      " ENGINE       : gproj: 'cache/RavenAICommander_6A3A112604EF7286/addon.gproj' guid: '6A3A112604EF7286' (packed)",
      "ENGINE       : Loaded addons:",
      " ENGINE       : gproj: './addons/data/ArmaReforger.gproj' guid: '58D0FB3206B6F859'",
      "DEFAULT      : [SaveGameManager] Starting new playthrough nr.0 '' for mission 'worlds/MainMenuWorld/MainMenuWorld.ent'.",
      "ENGINE       : Loaded addons:",
      " ENGINE       : gproj: './addons/data/ArmaReforger.gproj' guid: '58D0FB3206B6F859'",
      " ENGINE       : gproj: 'cache/RavenAICommander_6A3A112604EF7286/addon.gproj' guid: '6A3A112604EF7286'",
      "DEFAULT      : [SaveGameManager] Starting new playthrough nr.0 '' for mission '{C41618FD18E9D714}Missions/23_Campaign_Arland.conf'.",
      "SCRIPT       : SCR_BaseGameMode::OnGameStateChanged = GAME",
      "SCRIPT       : [RavenAI 1.0.2 TEST FIX3] AUTO RUNTIME STARTED - server authority confirmed.",
      "SCRIPT       : [RavenAI 1.0.2 TEST FIX3] AUTO BOOTSTRAP COMPLETE - source=SCR_GameModeCampaign.OnGameStart.",
      "SCRIPT       : [RavenAI 1.0.2 TEST FIX3] FACTION LOGISTICS READY - contexts=2",
      "SCRIPT       : [RavenAI] SUPPLY_RUN CLAIMED - faction=US",
      "SCRIPT       : [RavenAI] SUPPLY_RUN BLOCKED - no source",
    ].join("\n");
    const summary = summarizeReforgerLog(log, logPath);
    expect(summary.mission).toEqual({ line: 9, text: "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf" });
    expect(summary.gameReachedForLatestMission).toBe(true);
    expect(summary.gameTransition?.line).toBe(10);
    expect(summary.loadedAddons.map((addon) => addon.guid)).toEqual(["58D0FB3206B6F859", "6A3A112604EF7286"]);
    expect(summary.raven.runtimeStarted?.line).toBe(11);
    expect(summary.raven.bootstrapComplete?.line).toBe(12);
    expect(summary.raven.logisticsReady?.line).toBe(13);
    expect(summary.supplyRuns).toMatchObject({ total: 2, claimed: 1, blocked: 1, reportedTransfers: 0 });
    expect(summary.deliveryVerification).toBe("not_established_by_log");
    expect(formatLogSummary(summary)).toContain("Delivery: not verified by this log");
  });

  it("does not carry a prior mission's GAME or Raven activity into a later incomplete mission", () => {
    const log = [
      "DEFAULT : Starting new playthrough nr.0 '' for mission 'worlds/GameMaster/GM_Arland.ent'.",
      "SCRIPT : SCR_BaseGameMode::OnGameStateChanged = GAME",
      "SCRIPT : [RavenAI] AUTO RUNTIME STARTED",
      "SCRIPT : [RavenAI] SUPPLY_RUN CLAIMED",
      "DEFAULT : Starting new playthrough nr.1 '' for mission '{C41618FD18E9D714}Missions/23_Campaign_Arland.conf'.",
      "ENGINE : Game successfully created.",
    ].join("\n");
    const summary = summarizeReforgerLog(log, logPath);
    expect(summary.gameReachedForLatestMission).toBe(false);
    expect(summary.gameTransition).toBeUndefined();
    expect(summary.raven.runtimeStarted).toBeUndefined();
    expect(summary.supplyRuns.total).toBe(0);
  });

  it("labels transfer words as log reports only and recognizes fatal join errors", () => {
    const log = [
      "SCRIPT : [RavenAI] SUPPLY_RUN CLAIMED - truck spawned",
      "SCRIPT : [RavenAI] SUPPLY_RUN TRANSFERRED 100 supplies",
      "RPL       (E): ClientImpl event: handshake timeout (identity=0x00000000)",
      "NETWORK   (E): Unable to connect as client to '127.0.0.1'",
      "ENGINE    (E): Unable to initialize the game",
      "RPL : RplAuthBackend::OnFailure reason=3",
    ].join("\n");
    const summary = summarizeReforgerLog(log, logPath);
    expect(summary.supplyRuns).toMatchObject({ total: 2, claimed: 1, reportedTransfers: 1 });
    expect(summary.deliveryVerification).toBe("not_established_by_log");
    expect(summary.joinOrStartupFailureCount).toBe(4);
    expect(summary.joinOrStartupFailures.map((failure) => failure.kind)).toEqual([
      "RPL handshake timeout",
      "Unable to connect as client",
      "Unable to initialize the game",
      "RPL authentication failure (reason 3)",
    ]);
    expect(formatLogSummary(summary)).toContain("1 log-reported transfers");
  });

  it("keeps only the eight most recent supply events in the concise evidence sample", () => {
    const log = Array.from({ length: 12 }, (_, index) => `SCRIPT : [RavenAI] SUPPLY_RUN BLOCKED attempt=${index + 1}`).join("\n");
    const summary = summarizeReforgerLog(log, logPath);
    expect(summary.supplyRuns.total).toBe(12);
    expect(summary.supplyRuns.recentEvents).toHaveLength(8);
    expect(summary.supplyRuns.recentEvents[0].line).toBe(5);
    expect(summary.supplyRuns.recentEvents.at(-1)?.line).toBe(12);
  });
});
