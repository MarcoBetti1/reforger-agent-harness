# Reforger operations playbook

This records procedures observed on the Windows test machine. Recheck versions, paths, window titles, and world resources after game updates. Keep one run's exact command, script log, visible result, and recording together; a startup message is not proof of gameplay behavior.

## Machine setup

The verified installation had Reforger, Reforger Tools/Workbench, a matching dedicated server, Node.js 24, and FFmpeg. Steam library discovery is built into the launchers; `npm run cli -- doctor` reports what they actually resolve. The personal `reforger-agent.config.json`, Workshop packages, logs, recordings, and local profiles stay in ignored paths. Copy the example config and add project/sample roots appropriate for the current machine.

Run `npm run knowledge:prepare` to locate installed Enfusion API HTML and cache selected official Bohemia wiki pages. Existing snapshots are reused; `prepare-knowledge --force` refreshes them. See [knowledge-sources.md](knowledge-sources.md).

## Opening Workbench directly

```powershell
npm run workbench:open -- --editor script --project 'C:\Path\To\Addon\addon.gproj'
npm run workbench:open -- --editor world --project 'C:\Path\To\Addon\addon.gproj' --world 'Worlds/Tests/Scene.ent' --authorize-local-test-scripts --execute
```

The first command prints a dry run. The second passes `-gproj`, the installed base-game addons directory, World Editor module, `-run`, `-load`, and the explicit `-scriptAuthorizeAll` opt-in. Direct Script Editor and World Editor launches were tested; they avoid the Workbench Launcher project dropdown. `--authorize-local-test-scripts` prevented the refresh authorization dialog in repeated local test previews. Use it only with source you are prepared to execute. Opening a different project creates or changes top-level windows; enumerate them again rather than using a stale window handle.

If the World Editor opens off screen, first select the unique current editor window by title, then use the Windows system menu sequence **Alt+Space, X** to maximize it. In a live recovery, this changed its accessibility state from an off-screen window to a visible Maximized window; Restore then returned a visible usable window. Reinspect the window state after either transition before sending editor input. Avoid writing addon scripts while any Workbench editor has the project open: its live reload can occur even before F5 and can invalidate a concurrent preview.

For headless checks:

```powershell
npm run workbench -- validate --project 'C:\Path\To\Addon\addon.gproj' --execute
npm run workbench -- pack --project 'C:\Path\To\Addon\addon.gproj' --output '.cache/local-addons/Addon' --execute
```

The helper supplies the base-game addon directory and checks validation/pack output. Keep package output outside the source project. Workbench validation, a packed `data.pak`, and clean TypeScript tests cover different failure classes; none confirms an AI or player interaction occurred.

### Unattended F5 pattern

1. Build a small addon test world containing deterministic starting entities and an addon-owned probe. Have the probe issue bounded commands on authority and log unit IDs, target IDs, waypoint changes, states, positions, and failure reasons. Do not depend on a human navigating menus for every iteration.
2. Open that world directly with `workbench:open --authorize-local-test-scripts --execute`; reacquire the actual World Editor window and press F5 once. `-run` launches the editor but does not by itself prove a gameplay preview began. A test component can print `AUTO_INIT` during editor entity initialization. Require a later GAME transition and gameplay-ready marker such as `AUTO_READY` in the current `.cache/workbench-gui-runs/<run>/script.log`, plus the live viewport, before interpreting the test.
3. Watch a clearly scoped PASS/FAIL marker from the current run. Require physical movement, stable spacing, and an appropriate terminal state rather than acceptance of an order alone. Keep navigation diagnostics at a moderate interval so logs remain readable.
4. Record the gameplay monitor with `screen:record` while the run executes. Inspect frames as well as logs. Stop F5 before editing scripts or repacking, then repeat from a fresh run.

This harness supplies launch and capture commands; world probes and pass criteria belong with the addon. A recent addon test showed why: an accepted waypoint and a success-looking log could coexist with a vehicle that drifted off the road. The later probe measured road distance, following gaps, and a stable dwell before marking a road run successful. Gameplay video remained a separate check.

### Player menu and input tests

For a test that must open the native map menu, use the game's `MenuManager.OpenMenu(ChimeraMenuPreset.MapMenu)` from an addon-owned fixture after the local game has initialized its menu manager. A direct scripted `SCR_MapEntity.OpenMap` call produced a VM exception because `RootWidgetRef` was null in a live Workbench preview. The menu-manager path opened the map and displayed an addon panel; mouse-issued Hold and Resume orders reached authoritative completed states in that run. Opening the map with an injected **M** key was not established, and a subsequent **Escape** ended the F5 preview, so map closing and restored steering/throttle remain separate test gates. Keep the owner in a real driver seat for those input gates; a passenger-seat probe cannot prove driving controls are restored.

Separate an order's stages in both UI and telemetry: request accepted, executing, physically completed, or unable to proceed. A button click, a waypoint insertion, and a server acknowledgement do not establish physical completion. A strict log parser should require the world and expected actors, the terminal success marker from the current run, real position/seat/target checks, and no new engine/world/resource/script/replication errors. If installed Workbench emits known base-world errors before the probe initializes, exempt only those exact pre-init messages and report their count. Preserve the raw recording; make proof clips with modest crops and captions limited to log-verified events. State explicitly when a fixed camera loses a truck outside its view.

## Screen recording

```powershell
npm run screen:record -- --backend ddagrab --output-idx 1 --fps 8 --duration-seconds 300 --output '.cache/test-videos/raw.mp4' --execute
npm run screen:clip -- --input '.cache/test-videos/raw.mp4' --output '.cache/test-videos/cropped.mp4' --left 1000 --top 120 --width 2060 --height 1060 --execute
```

The tested FFmpeg `ddagrab` Desktop Duplication path captured the selected display including Workbench gameplay. `gdigrab` named-window capture produced a stale white or old frame on this machine in an earlier test. The default clip crop is specific to a tested 3440×1440 display; set bounds for the current window. Both commands dry-run without `--execute`, and both refuse to overwrite an existing output. Keep private desktop content off the recorded monitor.

## Isolated game client

```powershell
npm run client:run -- --profile '.cache/client/profiles/vanilla-gm' --world 'worlds/GameMaster/GM_Arland.ent' --duration-seconds 600 --expect-game --execute
```

The launcher starts the game with its executable directory as working directory and a fresh or explicitly reused isolated profile. Direct `--world` launch reached Game Master Arland and bypassed the unreliable **Press Enter** menu gate. `--expect-game` requires a logged GAME transition; inspect the actual UI to prove action results. Use `--keep-open` instead of a duration for a user handoff.

In a graphical test, select the current game window before input. A window can be behind another app while remaining capturable; activate it before treating it as minimized. Individual key events worked in the Workshop search field where clipboard-style text insertion did not. The magnifier did not apply a search until **Enter** was pressed. In first person, some injected map and menu keys did not respond although a physical keyboard key did. Capture the window, make one visible action, and capture again rather than repeating blind clicks. Do not reuse coordinates after a window transition.

## Private server and Workshop acquisition

```powershell
npm run mod:fetch -- --mod '<WorkshopID=Name>' --execute
npm run conflict:host -- --mod '<WorkshopID=Name>' --keep-open --execute
npm run server:config -- --scenario '{C41618FD18E9D714}Missions/23_Campaign_Arland.conf' --mod '<WorkshopID=Name>' --out '.cache/local-server/test.json'
npm run server:run -- --config '.cache/local-server/test.json' --profile '.cache/local-server/profiles/test' --execute
```

The guarded server runner checks live UDP endpoints and requires loopback binding for these local tests. The one-command fetcher downloaded and verified a Workshop pack in a reusable cache and stopped its hidden server afterward. A bare `-server` world-launch experiment ignored loopback bind flags and listened broadly, so use the JSON config route. A server-fetched pack can be loaded by an isolated client with `--addons-dir`/`--addon`, but it did **not** appear automatically in the client's Host Mods UI. In the Raven probe, an actual in-game Workshop download registered it there; file copying alone did not.

A private player-hosted Conflict Arland session reached GAME and its single loopback UDP listener was checked. The separate automatic dedicated-server client join timed out during authentication in both modded and no-mod controls. A GAME server log does not prove a client joined. Treat `conflict:host` as a server setup path until the manual Direct Connect path is verified on the current installation. Details of the third-party probe remain in [raven-field-notes.md](raven-field-notes.md).

## Review evidence

`npm run logs:summary -- --log '<console.log>'` reports the latest mission, loaded addons, join failures, and one Raven-specific adapter for its runtime/supply events. Its event count is read-only and point-in-time. A claimed supply run or even a logged transfer needs corroboration through visible vehicle movement and before/after resource counts. For any addon feature, record game version, addon IDs, scenario, command, timing, actions, before/after UI, log path, observed outcome, and a recovery note if it failed.
