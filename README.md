# Reforger agent harness

Reusable local tools and operating notes for Arma Reforger and Enfusion Workbench. This repository contains **no addon source, packaged game data, voice assets, or game recordings**. The first addon developed with it lives separately in [Reforger Convoy Follower](https://github.com/MarcoBetti1/reforger-convoy-follower).

The harness opens Workbench directly on a chosen project and world, validates and packs addons, launches isolated clients or private local servers, inspects logs and packages, and records evidence from a Windows display. Commands that start or change a game process dry-run until `--execute` is supplied.

## Setup

1. Install Node.js 24+, Arma Reforger, and Arma Reforger Tools. A dedicated server is optional for local hosting and Workshop fetches. Install FFmpeg if you want recordings.
2. Run `npm ci`.
3. Copy `reforger-agent.config.example.json` to `reforger-agent.config.json` and edit the roots for your machine. The personal config and all `.cache` output are Git ignored.
4. Run `npm run cli -- doctor` and `npm run typecheck && npm test && npm run build`.
5. Read the [handoff](docs/harness-handoff.md) and [operations playbook](docs/operations-playbook.md) before a live test.

An optional read-only MCP server is available through `npm start` after building. `npm run knowledge:prepare` locates installed Enfusion API HTML and saves selected official Bohemia documentation into an ignored cache. The local tools never need a Workshop package committed to this repository.

## Workbench and gameplay loop

```powershell
npm run workbench:open -- --editor world --project 'C:\Path\To\MyAddon\addon.gproj' --world 'Worlds/Tests/MyScene.ent'
npm run workbench:open -- --editor world --project 'C:\Path\To\MyAddon\addon.gproj' --world 'Worlds/Tests/MyScene.ent' --authorize-local-test-scripts --execute
npm run workbench -- validate --project 'C:\Path\To\MyAddon\addon.gproj' --execute
npm run workbench -- pack --project 'C:\Path\To\MyAddon\addon.gproj' --output '.cache/local-addons/MyAddon' --execute
npm run client:run -- --profile '.cache/client/profiles/clean' --world 'worlds/GameMaster/GM_Arland.ent' --expect-game --duration-seconds 600 --execute
```

`--authorize-local-test-scripts` opts a **single Workbench process** into its supported `-scriptAuthorizeAll` flag. This avoids the local script-refresh authorization dialog during unattended F5 previews; omit it for untrusted addon source. Reacquire the editor window after each launch or transition, press F5, inspect `script.log` and the actual view, then stop the preview before modifying scripts. A `GAME` log transition or a successful package alone does not prove an in-world feature works.

For repeatable scenarios, put a deterministic test entity or probe in the addon test world. Log a start marker, accepted orders, unit IDs, assigned targets, state transitions, failure reasons, and a terminal PASS or FAIL backed by physical state. Pair the log with a screen recording and inspect both. The addon-specific probe and acceptance parser belong with the addon, not in this harness. For native map UI tests, open `ChimeraMenuPreset.MapMenu` through the game's `MenuManager`; direct `SCR_MapEntity.OpenMap` caused a null `RootWidgetRef` exception in a local F5 test. Map opening by injected **M**, closing, and restored driver controls must each be tested separately; see the [playbook](docs/operations-playbook.md).

## Evidence capture

```powershell
npm run screen:record -- --backend ddagrab --output-idx 1 --fps 8 --duration-seconds 300 --output '.cache/test-videos/raw.mp4' --execute
npm run screen:clip -- --input '.cache/test-videos/raw.mp4' --output '.cache/test-videos/review.mp4' --left 1000 --top 120 --width 2060 --height 1060 --execute
```

The Desktop Duplication backend captures an entire monitor; choose the index and clear other windows from that display. On this machine it captured the Workbench preview reliably where the named-window `gdigrab` backend returned a stale frame. The clip helper's default crop matches the tested 3440×1440 monitor and can be overridden. Both helpers refuse to overwrite files. Recordings stay in `.cache` unless deliberately copied into an addon repository.

## Other commands

- `npm run cli -- project-info`, `scan-mod`, `search-text`, `list-packaged-resources`, or `search-packaged-data` for read-only inspection.
- `npm run mod:fetch -- --mod '<WorkshopID=Name>' --execute` to fetch into a reusable isolated server cache.
- `npm run conflict:host -- --mod '<WorkshopID=Name>' --keep-open --execute` for a private loopback Conflict server.
- `npm run server:config -- ...` and `npm run server:run -- ...` for explicit scenarios and local binding.
- `npm run logs:summary -- --log '<console.log>'` for a concise log index. Its Raven event adapter is retained as a documented example; it never treats a run claim as proof of delivery.

See each command's `--help` for arguments. The [Raven field notes](docs/raven-field-notes.md) preserve one early third-party mod probe as observed evidence, distinct from that mod's Workshop claims.

## Verification and limits

GitHub Actions runs TypeScript typechecking, unit tests, and compilation. Workbench validation, game startup, graphics capture, and player behavior require a local Windows installation and are not covered by that CI check. A vanilla local dedicated-server join previously timed out during authentication; direct `--world` launch and Workbench F5 are the verified local gameplay paths. The detailed observations and recovery steps are in the [playbook](docs/operations-playbook.md).

The source is public for version control. No reuse license has been selected yet.
