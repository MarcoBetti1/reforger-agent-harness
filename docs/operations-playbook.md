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

### Keeping a GUI run reproducible

Keep addon source and test worlds unchanged while Workbench has the project open, especially during F5. Saving a test script during a live preview has triggered Workbench hot reload and a `Resources are leaking!` diagnostic; that timing is consistent with the save disrupting the preview, though the diagnostic did not prove its exact cause. Stop the preview, close the editor, validate and repack, then reopen a fresh GUI process for the next version. Do not overwrite a packed `data.pak` while a direct client is using it. Give each GUI or packed-client run a new log and video path and record the pack or source revision.

The Workbench opener's `-run` loads the editor; an addon component may log initialization before gameplay. If F5 does not change the freshly observed editor view, the green Play toolbar control started a local survey preview. Reacquire the current window after a launcher, editor switch, or modal dialog, and confirm the subsequent `GAME` line and a probe-ready marker. Exiting the preview may append editor initialization to the same log. When a strict report needs the world-load line, use the current `console.log`; `script.log` alone may omit that line. A second F5 did not reliably end an embedded preview in one observed run, so use the observed Game exit control and verify that the preview actually closed.

### Unattended F5 pattern

1. Build a small addon test world containing deterministic starting entities and an addon-owned probe. Have the probe issue bounded commands on authority and log unit IDs, target IDs, waypoint changes, states, positions, and failure reasons. Do not depend on a human navigating menus for every iteration.
2. Open that world directly with `workbench:open --authorize-local-test-scripts --execute`; reacquire the actual World Editor window and press F5 once. `-run` launches the editor but does not by itself prove a gameplay preview began. A test component can print `AUTO_INIT` during editor entity initialization. Require a later GAME transition and gameplay-ready marker such as `AUTO_READY` in the current `.cache/workbench-gui-runs/<run>/script.log`, plus the live viewport, before interpreting the test.

If an injected F5 leaves the loaded editor unchanged, reacquire a fresh screenshot of the World Editor and click its green **Play** toolbar control once. This worked in a local survey run where F5 did not. Require the later `GAME` marker; an editor-time component log remains insufficient. Toolbar coordinates can change with window placement and scaling.
3. Watch a clearly scoped PASS/FAIL marker from the current run. Require physical movement, stable spacing, and an appropriate terminal state rather than acceptance of an order alone. Keep navigation diagnostics at a moderate interval so logs remain readable.
4. Record the gameplay monitor with `screen:record` while the run executes. Inspect frames as well as logs. Stop F5 before editing scripts or repacking, then repeat from a fresh run.

This harness supplies launch and capture commands; world probes and pass criteria belong with the addon. A recent addon test showed why: an accepted waypoint and a success-looking log could coexist with a vehicle that drifted off the road. The later probe measured road distance, following gaps, and a stable dwell before marking a road run successful. Gameplay video remained a separate check.

When a test world stores actors in `<world>_Layers/default.layer`, keep the corresponding `.ent` as the `SubScene` parent header only. Do not copy the actor definitions into both files. A live test loaded both copies, creating overlapping vehicles and two copies of its order probe; the resulting failed recruitment and stalled lead were fixture errors rather than navigation evidence. Before interpreting a run, require exactly one gameplay probe and the expected actor count after `GAME`. An editor-time initialization followed by one preview initialization is normal; two probe instances in the same live world are not.

### Scripted vehicle-control calibration

Calibrate gear indexing against the installed APIs before treating throttle plus displacement as powered driving. The installed `SCR_FuelConsumptionComponent` declares `NEUTRAL_GEAR = 1`. Bohemia's [cinematic vehicleGO sample](https://github.com/BohemiaInteractive/Arma-Reforger-Samples/blob/main/SampleMod_CinematicTutorial/Scenes/Cinematic_Tutorial_default.layer) uses `SetGear(2)` to drive. The [VehicleWheeledSimulation API](https://community.bistudio.com/wikidata/external-data/arma-reforger/ArmaReforgerScriptAPIPublic/interfaceVehicleWheeledSimulation.html) states that clutch value 0 disengages it and 1 fully engages it. Recheck these values when the installed vehicle or API changes.

A previous local calibration selected gear 1 and counted 24 m of downhill motion as a success, even though it moved opposite the vehicle's facing. That result is invalid as powered-forward evidence. A corrected fixture must log engine RPM, gear, clutch, throttle, brake/handbrake, callback count, facing, and signed progress toward its goal. Require positive net route progress; a short uphill leg adds a useful check against gravity-only motion. Preserve failed or misclassified recordings as diagnostics, and do not publish them as successful driving proof.

Displayed setter values can differ from controls used around physics. In a subsequent owner-pilot test, POSTFRAME reported gear 2, clutch 1, throttle 0.28–0.8 and brake 0, while pre/post-physics reads also caught clutch 0, throttle 0 and brake 1. Physics callbacks then stopped although POSTFRAME continued. Switching the write location to SIMULATE could not test that location while its callbacks were inactive. Log before writes as well as afterward, including callback counts; a setter readback is not movement evidence.

A final bounded follow-up called `Physics.SetActive(ActiveState.ACTIVE)` once on entering each SIMULATE stage. It restored physics callbacks (1,280 over the run), with `IsActive()` true, but controls still differed across phases and the vehicle made only −0.228 m of signed progress over 40 seconds. Pilot-control locking also did not establish powered forward movement in this test. Wakefulness and callback execution therefore do not prove successful input ownership. These results concern a player-occupied test fixture, not every NPC vehicle. Stop an unsuccessful test-driver branch and use a physically proven AI lead or fixed reference course for navigation tests; keep low-level input calibration separate.

### Stable terminal states and native AI speed requests

A native `AICarMovementComponent.SetCruiseSpeed` request measurably reduced throttle and applied braking in a local AI driving comparison. Resolve the component's `GetAIAgent().GetControlledEntity()` to the intended vehicle before treating it as owned. The API request is not proof of a hard speed limit or a persistent stop: a test lead given cruise zero plus handbrake stopped briefly, then reversed later while its follower remained stationary. Reset only overrides the test owns. Record requested speed, actual speed, controls, position, and ownership rather than inferring success from the setter.

A ten-second settled marker missed that later reversal. For parking or unloading, require a dwell appropriate to the real interaction (at least thirty seconds in the next hold comparison), retain full post-terminal footage/logs, and distinguish the fixture's own lead behavior from the addon follower. A successful early marker must not erase later contradictory evidence. Report physical scenario, surface, runtime health, and shutdown separately; retain an overall strict verdict. Annotate an exactly reproduced vanilla error with its baseline evidence instead of suppressing it, and scan load errors preceding the probe's initialization as well as GAME and teardown.

### Surface and terrain evidence

Distance from the mapped road network does not establish off-road travel. A field survey passed clearance and road-distance checks, but its live route crossed an airfield taxiway; wheel contacts reported concrete despite being over 100 m from a mapped road. A few grass contacts did not make the whole route a grass test. Inspect the visible terrain and sample actual contact materials during movement using `VehicleWheeledSimulation.WheelHasContact`, `WheelGetContactMaterial`, and `WheelGetContactPosition`; the material resource can be identified through `GetResourceName`. Classify mixed surfaces explicitly and require a measured continuous interval on the intended surface. No contact or an unnamed resource is inconclusive.

### Player menu and input tests

For a test that must open the native map menu, use the game's `MenuManager.OpenMenu(ChimeraMenuPreset.MapMenu)` from an addon-owned fixture after the local game has initialized its menu manager. A direct scripted `SCR_MapEntity.OpenMap` call produced a VM exception because `RootWidgetRef` was null in a live Workbench preview. The menu-manager path opened the map and displayed an addon panel; mouse-issued Hold and Resume orders reached authoritative completed states in that run. Opening the map with an injected **M** key was not established, and a subsequent **Escape** ended the F5 preview, so map closing and restored steering/throttle remain separate test gates. Keep the owner in a real driver seat for those input gates; a passenger-seat probe cannot prove driving controls are restored.

Separate an order's stages in both UI and telemetry: request accepted, executing, physically completed, or unable to proceed. A button click, a waypoint insertion, and a server acknowledgement do not establish physical completion. A strict log parser should require the world and expected actors, the terminal success marker from the current run, real position/seat/target checks, and no new engine/world/resource/script/replication errors. A base-world asset warning can appear after `GAME` and a probe's initial marker while the world is still loading; if a known warning needs an exception, match its exact base asset, warning text, and loading context, then fail the same warning during gameplay. Count every exception. Preserve the raw recording; make proof clips with modest crops and captions limited to log-verified events. State explicitly when a fixed camera loses a vehicle outside its view.

## Screen recording

```powershell
npm run screen:record -- --backend ddagrab --output-idx 1 --fps 8 --duration-seconds 300 --output '.cache/test-videos/raw.mp4' --execute
npm run screen:clip -- --input '.cache/test-videos/raw.mp4' --output '.cache/test-videos/cropped.mp4' --left 1000 --top 120 --width 2060 --height 1060 --execute
```

The tested FFmpeg `ddagrab` Desktop Duplication path captured the selected display including Workbench gameplay. `gdigrab` named-window capture produced a stale white or old frame on this machine in an earlier test. Confirm `--output-idx` for the current monitor setup, inspect several frames for actual movement, and state when a fixed camera loses an actor. The default clip crop is specific to a tested 3440×1440 display; set bounds for the current window. Both commands dry-run without `--execute`, and both refuse to overwrite an existing output. Finish the recorder before running `ffprobe` or `screen:clip`: an MP4 still being written lacks its final index. The tested `ddagrab` command records video without game audio. Keep private desktop content off the recorded monitor.

## Isolated game client

```powershell
npm run client:run -- --profile '.cache/client/profiles/vanilla-gm' --world 'worlds/GameMaster/GM_Arland.ent' --duration-seconds 600 --expect-game --execute
```

The launcher starts the game with its executable directory as working directory and a fresh or explicitly reused isolated profile. Direct `--world` launch reached Game Master Arland and bypassed the unreliable **Press Enter** menu gate. `--expect-game` requires a logged GAME transition; inspect the actual UI to prove action results. Use `--keep-open` instead of a duration for a user handoff.

### Packed-client acceptance

For a packed addon, keep the package output outside its source project and pass its GUID and the parent of its packed addon directory through `--addon <GUID> --addons-dir <root>`. The launcher checks that an addon with that GUID is present; inspect the current log's loaded-addon list to confirm which build ran. `--expect-game` then checks only the current client's `GAME` transition. A clean exit after that transition is a startup pass, even if the addon never issued its intended order. Require a separate addon-owned probe or player test with the exact world and actors, an authoritative accepted order, a terminal result grounded in physical position/seat/target state, an error scan, and inspected video. Preserve the failed run as evidence rather than interpreting a missing terminal marker as a pass.

Use a single-build addon root, for example `.cache/test-addons/MyAddon/{addon.gproj,data.pak,resourceDatabase.rdb}`, then pass `--addons-dir .cache/test-addons --addon <GUID>`. Copy all three files from the same completed pack. The launcher rejects a selected packed addon with a missing, empty or non-file `resourceDatabase.rdb` before starting the client; source projects without `data.pak` remain supported. A September 26 live attempt discovered the pack but failed to load its world when `--addon` was omitted. Passing the inner pack folder directly then failed the launcher's GUID check. An isolated parent with one addon subfolder resolves both setup errors and prevents a root containing several packs with the same GUID from selecting the wrong build. These are startup failures, separate from gameplay outcomes.

Use a fresh `--run-dir` and record SHA-256 hashes of all three files for every acceptance run. Keep the entire copied addon unchanged until that client exits; stop it and use a new isolated copy after repacking. The preflight checks database presence, not whether the files came from the same build or whether every dependency exists. The verified server-fetched Workshop package also has these three core files, plus manifests and metadata; preserve those additional files when copying a Workshop installation. The addon-specific strict parser and test worlds belong in the addon repository, not this reusable harness.

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
