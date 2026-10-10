# Native visual capture

The installed stable Reforger 1.8.0.13 renderer successfully writes BMP pixels with `System.MakeScreenshot("$profile:NativeCapture-...")`. An absolute D: filename had failed in the earlier aircraft fixture. The engine appends `.bmp`; omit the extension. The native call's Boolean does not establish useful pixels: decode, validate and inspect the file.

The runner extends this harness; the native fixture, worlds, asset configurations and evidence live in a separate project. The current fixture is `C:\Users\marco\Documents\Codex\2026-10-10\task\capture-lab\addon`, GUID `4B62C90E6D184A73`. The private target snapshot and bounded evidence live under `D:\ArmaProjects\NativeVisualCapture-20261010`. No aircraft model, gameplay script, original world, user's profile or production thumbnail was edited for these captures.

## Running

Run from this checkout. Installed Node 24 and Python 3.11 with Pillow/NumPy suffice; no software installation was used.

Open the existing representative exterior sheet locally:

```powershell
Invoke-Item -LiteralPath 'D:\ArmaProjects\NativeVisualCapture-20261010\runs\s64-stopped-001\review\contact-sheet.png'
```

Complete one-command native crew capture, from any working directory (choose a new run name):

```powershell
& 'C:\Users\marco\Documents\Codex\2026-10-10\task\capture-lab\Capture.ps1' -Job s64-native-crew -RunName marco-crew-review-001 -Execute
```

The wrapper supports `-Job m998-three|s64-stopped|s64-occupied|s64-running|s64-native-crew`, `-Config` for a custom JSON, `-RunName`, `-OutputRoot`, `-Game`, `-Python`, `-AddonIds`, and `-AddonRoots`. Omitting `-Execute` produces a dry run. It uses the same bounded runner and ownership/storage/evidence guards.

```powershell
npm run visual:capture -- --config '..\jobs\m998-three.json' --game 'D:\SteamLibrary\steamapps\common\Arma Reforger\ArmaReforgerSteamDiag.exe' --run-dir 'D:\ArmaProjects\NativeVisualCapture-20261010\runs\choose-new-name' --fixture-root '..' --addon 4B62C90E6D184A73 --addons-dir '..' --python 'C:\Users\marco\AppData\Local\Programs\Python\Python311\python.exe'
```

This is a dry run. Add `--execute` to create the fresh profile and spawn the owned renderer. Aircraft jobs also select `--addon 6D52D7DC46B84208 --addons-dir 'D:\ArmaProjects\NativeVisualCapture-20261010\target-addons'`. Never rename or repack a target's source files merely to satisfy discovery; the runner recognizes GUIDs in named source `.gproj` files. Packed targets still need the existing verified `addon.gproj/data.pak/resourceDatabase.rdb` trio.

Every run refuses an existing destination, checks storage, acquires one renderer lock, uses an isolated profile, requests unfocused rendering, bounds wall time to 180 seconds, and only stops the child it spawned. It does not use desktop capture, OS input, game memory, global user configuration, `WorldSaveItem.SaveJPEG`, or production asset thumbnails. Its native fixture requests normal closure after terminal completion. Startup and shutdown diagnostics remain in the full console; a visual pass does not claim a clean engine run.

## Job configuration

| JSON setting | Meaning |
| --- | --- |
| `prefab` | Selected native/private addon entity resource |
| `position` | X, height above local terrain, Z |
| `center`, `useBounds` | Target offset or current bounds center |
| `resolution` | Decoded render dimensions, 320x240 to 3840x2160 |
| `initialSettleSeconds`, `settleSeconds` | State/asset warmup and per-view settling |
| `state`, `seats`, `minRPM` | Measured stopped/occupied/running state and exact crew/RPM requirements |
| `views[].label` | Unique output label; at most 24 views |
| `azimuth`, `elevation`, `distance` | World-space camera orbit |
| `offset`, `lookOffset`, `fov` | Explicit eye/target offsets and vertical field of view |
| `purpose`, `nativeSeat` | Exterior/inspection view or true controlled native crew camera |
| `buildFiles` | Extra source/model files hashed before and after the run |

`prefab` is an installed native resource or a selected private addon prefab. `position` gives X, height above terrain, Z. `center` offsets the target's local origin; `useBounds:true` instead frames the current world bounds and applies the center offset in world space. Camera `azimuth/elevation/distance` produce world-space offsets; an explicit `offset` overrides these. Each view has a unique label, target `lookOffset`, FOV and purpose. Resolution, initial settling and per-view settling are bounded. Up to 24 frames are allowed.

`stopped` and `occupied` require the observed engine to be off; the rotorcraft adapter also requires stopped rotors. Declared seats use native character spawning and `GetInVehicle`, then verify exact compartment identity and occupancy. `running` calls the native controller's `StartEngine` and requires measured simulation RPM. Rotorcraft and wheeled adapters are implemented; other engine adapters must be added and tested before claiming their running state.

`purpose:"inspection"` describes a positioned camera. `purpose:"native-crew"` requires a declared `nativeSeat`, the isolated player-capable scene, exact controlled crew identity, native PlayerCamera and camera blending to finish. Exterior inspection does not establish first-person cockpit visibility. A bare Arland scene has no local player controller; preserve that failure rather than constructing a fake crew viewpoint.

Native crew views use the character's actual camera transform; orbit and look offsets do not override it. The fixture selects the camera before checking handler readiness, then waits for blending and the configured settling interval. Its direct local possession skips native spawn-response loading cleanup, so it calls the respawn system's public `DestroyLoadingPlaceholder()` after verifying the exact controlled crew and running owned game mode. The placeholder is a workspace widget, separate from loading animation and open menus. No global menu closure or OS input is involved.

## Evidence

`manifest.json` records exact command arguments, executable/config/source hashes, engine build lines, native poses and measured states. Source hashes are checked again after capture. The snapshot manifest records all 807 target files and source Git commit; its first comparison had no differing bytes.

Each completed frame must be a newly created native BMP, decode to the requested resolution, contain useful pixel variation, and have matching successful camera/state telemetry. Different views cannot reuse identical pixels. The reviewer keeps originals, writes full-resolution PNGs, labeled PNGs, a contact sheet and `validation.json`. Inspect the sheet and relevant full-resolution views; the automatic pixel gate cannot recognize a wrong model or diagnose geometry.

Verified on October 10: one 1280x720 M998 frame, a three-view M998 job, its fresh repeat, and four-view S-64 stopped, occupied and running jobs. Running aircraft frames measured 167.452 to 185 rotor RPM and two confirmed occupied compartments. These images reproduce the vertical main rotor and floating tail rotor defects. They establish reusable native visual evidence across ground and aircraft categories, not controlled flight, user input, lifting, multiplayer, late joining or WCS compatibility.

Native crew-camera runs `s64-native-crew-006` and `007` passed pixel validation and manual inspection: Pilot, Copilot and LiftOperator each use native PlayerCamera/index 0 at 55-degree FOV with three verified occupied compartments. Both runs exited naturally and source hashes stayed unchanged. Their six frames show real cockpit geometry and native HUD/actions. They expose incorrect seat-camera axes and clipping: pilot/copilot face almost vertically up, operator almost vertically down through geometry. All-role aft-station text is also an existing aircraft defect. Capture acceptance describes useful evidence, not usable crew stations. No aircraft/gameplay fix was made.

In `s64-native-crew-003` through `005`, valid camera telemetry and decoded BMP bytes still showed a loading-pattern screen. The engine loading flag was false and top menu NULL; character render activation did not repair it. Those runs remain explicitly rejected in `manual-visual-review.json`. The native respawn placeholder cleanup resolved this in `006` and the fresh `007` repeat. The runner reports automatic pixel/telemetry validation separately from manual visual acceptance.

Preserve other failed runs: `m998-three-001` failed a callback parameter-name compile check; `s64-native-crew-001` failed because the bare scene had no player controller; `002` timed out before native camera activation. Native camera selection must precede handler readiness inspection, or activation can never occur. Twenty-eight native frames across retained stock/exterior/crew proof and repeat runs are manually accepted. No owned renderer remains; Marco's existing game sessions were preserved.
