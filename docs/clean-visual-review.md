# Clean native visual review

Use an addon-owned neutral test world to compare a model without parked trucks,
trees or changing camera composition. Keep an ordinary outdoor daylight control
alongside the studio-like views. The harness supplies the original stage mesh
generator, portable recipe and guarded native capture client; the actual addon
world, Enforce adapter, target prefab and asset registry remain with the project.
No vehicle source, screenshots, model binaries, profiles or Library receipts are
part of this repository.

The originating local fixture passed native stage cooking, game-script startup,
24 soft-light camera stations and four additional clear/raking/outdoor views on
October 18, 2026. Its 28 accepted lossless frames had actual FOV, exposure,
weather, dry state and body/camera readbacks. A fresh launch using copied isolated
graphics settings matched the earlier settings readback. All 1,093 selected
checkpoint files remained byte-exact. These observations concern the project
fixture, not every adaptation of the portable tools. This sync was checked
without opening another renderer; repository tests are not Enfusion compilation.

## Prepare the project world

1. Create a separate development addon/world which depends on the selected
   checkpoint. Reference its prefab; do not duplicate or edit its vehicle assets.
   Keep manifests of every frozen input before/after a run. Give the review addon
   its own resource GUIDs. Cook only the new stage resources with base-game
   dependencies; avoid opening a frozen vehicle dependency in an importing editor.
2. Reuse a supported base world for atmosphere/weather. The proven fixture used
   Arland and a floor above the terrain at `[600,200,2600]`, with a 120 m flat
   radius, 20 m curved cove and 32 m lip height at 140 m radius. The inherited map
   stays loaded, so the small stage does not imply an empty-world GPU cost.
3. Generate the original stage outside this repository. Dry run with ordinary
   Python first; Blender is needed only for the explicit export:

   ```powershell
   python tools/build_neutral_review_stage.py --output 'D:\ReviewProject\Assets\ReviewStage.fbx'
   blender --factory-startup --background --threads 3 --python tools/build_neutral_review_stage.py -- --output 'D:\ReviewProject\Assets\ReviewStage.fbx' --execute
   ```

   The mesh has 1,793 vertices and 1,792 polygons. Outputs must be fresh; no open
   Blender scene is used. Assign `Review_MatteGrey` to an addon-owned PBR material
   using constant 16x16 BCR `(128,128,128,255)` and NMO `(128,128,0,255)` textures,
   roughness scale 1 and zero metallic channel. Keep emissions/detail maps off.
   Register and cook the FBX/textures with the project's established importer.
   Spawn a `GenericEntity` prefab containing a `MeshObject` with the cooked XOB;
   loading the XOB as an entity `Resource.Load` was not a working spawn route.
4. Spawn only the subject and the minimal local-player/loading setup needed by
   the native camera. The development fixture pins body pose, wheel phase and
   articulation as needed; record these as visual fixtures, not driving evidence.
   Hide the controlled actor away from the subject. Resolve native loading
   placeholders through the project fixture before recording readiness.
5. For the ordinary outdoor control, move the **entire stage away** before moving
   the subject to the ordinary apron. Leaving an elevated floor overhead shaded
   the outdoor control in the first probe. Retain that failure as diagnostic;
   do not present it as normal outdoor daylight.

Do not save scripts, worlds or metadata while their Workbench/runtime owns those
sources. Use a fresh isolated profile and run directory. Coordinate exclusive
renderer ownership with other work, and preserve any user/unknown session. This
client attaches to a supplied owner receipt; it never acquires a renderer lease,
starts a game, closes a process or changes user settings.

## Fixed camera and lighting recipe

Copy [visual-review.recipe.json](../examples/visual-review.recipe.json) into the
project and adjust its generic camera offsets to the target's actual bounds.
Eyes and targets are **subject-local metres** with root yaw/pitch/roll fixed to
zero. Use whole front/rear quarters, both profiles, roof, matched medium views
per side and close/grazing stations for each feature. Store project-specific
station names/datums beside the addon, including deployed/folded assemblies.
The example's `pose` field is optional and requires measured pose telemetry.

The proven baseline is 1280x720, vertical FOV 55 degrees and date 1989-06-21:

| Preset | Native weather/time | Fixed HDR brightness |
|---|---|---:|
| soft | Overcast, 12:00 | 0.040 |
| daylight | Clear, 12:00 | 0.00456415 |
| raking-east | Clear, 08:00 | 0.008 |
| raking-west | Clear, 17:00 | 0.008 |
| outdoor | Clear, 12:00; stage removed | 0.00456415 |

Exposure differs **between lights**, and stays fixed **within a light** for all
before/after pairs. The earlier 0.020 overcast setting hid dark rear details;
0.040 made them inspectable without an artificial lamp or material edit. These
are a calibrated starting point for this renderer, not a universal exposure for
all assets. Retain normal shadows and the outdoor control; do not polish defects
away with postprocessing. Native low-angle sun provides grazing light with sky
fill. A dedicated controlled lamp was not implemented.

The addon adapter uses supported engine calls already exercised by the fixture:

```cpp
weather.SetIsDayAutoAdvanced(false);
weather.SetDate(1989, 6, 21, true);
weather.ForceWeatherTo(true, kind, 0, 24); // Clear or Overcast
weather.SetTimeOfTheDay(hour, true);
weather.SetRainIntensityOverride(true, 0);
weather.SetCurrentWetness(0);
weather.SetCurrentWaterAccumulation(0, 0);
Math3D.DirectionAndUpMatrix((target-eye).Normalized(), vector.Up, pose);
pose[3] = eye;
camera.SetWorldTransform(pose);
camera.SetFOVDegree(55);
world.SetCameraHDRBrightness(camera.GetCameraIndex(), fixedExposure);
GetGame().GetCameraManager().SetCamera(camera);
camera.ApplyTransform(timeSlice);
```

Keep HDR brightness enforced on the selected camera each frame. Read back
`GetCameraHDRBrightness`, `GetVerticalFOV`, world transforms and the weather
manager's actual weather name/time/rain/wetness/water values. A request or command
acknowledgement alone is insufficient. Date is the adapter's frozen source
configuration; the existing protocol does not independently read it back.
Cloud/wind phase is not separately pinned, so atmospheric animation is not
claimed pixel-identical.

## Addon-owned GVR contract

Implement this small opt-in contract in the project adapter, keeping its actual
world and Enforce classes in that project repository:

* `$profile:GVR-command.txt` contains one `id|operation|arg...` line, atomically
  replaced by the client. Poll only in the dedicated review world.
* Accept only `stage`, `outdoor`, `preset|name`, `radar|folded/deployed`,
  `camera|eyeVector|targetVector`, `exposure|value`, `settings`, `frame|label`.
  `radar` is the legacy pose-operation name. A subject without articulation may
  acknowledge it as a no-op; stations with `pose` require actual deployment data.
* Log `GVR_ACK id=<id> op=<operation>` only after dispatch; use
  `GVR_REJECT id=<id>` for unsupported requests. Log `GVR_READY stage=1` only
  after stage/subject/camera/player/loading setup has actually succeeded.
* For `settings`, emit one `GVR_SETTING path=<module.field> ok=1 value=<actual>`
  per renderer field. The successful fixture recursively reflected engine user
  modules including GraphicsQuality, ResourceManager, Pipeline, Postprocess,
  Video, MaterialSystem and Display settings without writing them.
* For `frame`, emit the following readbacks, then call
  `System.MakeScreenshot("$profile:GVR-" + label)`. Omit the extension; the
  engine creates a BMP in this isolated profile. Its Boolean return does not
  prove a useful image. Keep screenshot labels constrained to the client grammar.

```text
GVR_ENV_ACTUAL label=<label> preset=soft weather=Overcast hour=12 wetness=0 rain=0 cracks=0 puddles=0
GVR_CAMERA label=<label> eye=<x,y,z> right=<x,y,z> up=<x,y,z> forward=<x,y,z> fov=55 exposure=0.04
GVR_BODY label=<label> origin=<x,y,z> right=<1,0,0> up=<0,1,0> forward=<0,0,1>
GVR_RADAR label=<label> deployment=0 sweep=180
GVR_PERF label=<label> samples=<n> meanFrameMs=<ms> maxFrameMs=<ms> capFPS=30 GPUTime=UNMEASURED
```

The last two lines are optional except for stations explicitly requiring a
pose. Forward-component tolerance is 0.0005, eye/stage tolerance is 1 mm and root
orientation tolerance is 1e-6. At a world Z near 2600, float32 close-target
subtraction produced small differences from double-precision local recipes.
Always retain the actual bases for exact matched-pair comparison rather than
calling the recipe mathematically exact.

## Capture without another renderer

Python 3.11+ and Pillow are needed for live BMP decoding. The dry run and recipe
validation use the standard library:

```powershell
python tools/visual_review.py --recipe examples/visual-review.recipe.json
python -m pip install -r tools/requirements-visual-review.txt
python tools/visual_review.py --recipe 'D:\ReviewProject\review.recipe.json' --owner 'D:\ReviewProject\checks\owner.json' --output 'D:\ReviewProject\runs\run-a\review' --label-prefix before --execute
```

The explicit owner receipt must contain absolute `run`, `profile`, `logs`, `exe`,
integer `pid` and UTC `creationUtc`; it must not contain `stoppedUtc`. Profile
and logs must be inside the owned run. On Windows, execution compares actual
PID/executable/creation time, parses actual process arguments and checks the
isolated `-profile`, exact recipe `-world` and `-noFocus`. The run must already
be coordinated and owned. Preserve that receipt with the project's launcher.

Use `--selection all --preset soft` for every station under one light. All
outputs must be new and inside the owned run; native BMP labels also refuse
reuse. PNGs preserve decoded RGBA pixels exactly. Original BMPs remain in the
profile. The client rejects missing readiness/acknowledgements, script errors,
blank or duplicate pixels, mismatched numeric readbacks and excessive raw image
budgets. It records a partial manifest on failures after capture begins.

For the next checkpoint, freeze/reference the new prefab and repeat with the
same recipe and copied isolated graphics configuration. Pass
`--settings-baseline <earlier-review/graphics-settings.json>`; any reflected
settings difference fails the comparison. A first capture records settings but
does not claim a baseline comparison. Copy the previous isolated
`profile/.save/<account>/settings/ReforgerEngineSettings.conf` and matching
`ReforgerGameSettings.conf` **before launch**, using the project launcher. Never
write to the normal user profile. Do not change the canonical recipe merely to
make one successor look better.

Inspect full-resolution images as well as the numeric/pixel results. A gradient
or loading screen can be nonblank, and correct camera telemetry can still frame
the wrong geometry. The tool therefore leaves `manualVisualAcceptance` pending.
Keep failed, occluded or underexposed probes labeled and excluded from accepted
evidence. A small representative set should include soft whole/profile views,
normal daylight, both useful raking sides and the outdoor control.

## Scope and performance

The originating stage addon was about 480 KiB, excluding referenced checkpoint
assets. Capped mean frame intervals were 33.36-33.41 ms with a 93.13 ms maximum
including weather transitions/screenshots. Those cumulative intervals are not
isolated stage overhead or a GPU benchmark. Active LOD indices, texture mip
residency and GPU timings remain unmeasured. Tiny native FPS/version text may
remain in frames. Visual fixture success does not establish driving, physical
input, sensors, multiplayer, crew usability or natural shutdown.

Keep all generated FBX/BLEND/XOB/TXO/textures, frames, profiles, logs, ownership
receipts, machine paths and private Library identifiers in the addon project or
ignored output storage. This workflow neither publishes to Workshop nor uploads
evidence. Obtain the user's scoped authorization for any external delivery.
