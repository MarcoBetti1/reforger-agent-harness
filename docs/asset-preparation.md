# Prepare an asset against the game contract

Use the existing `visual` workflow, [semantic gates](asset-review.md),
[clean camera fixture](clean-visual-review.md) and
[asset case recipe](../examples/workflows/asset-preparation-cases.example.json).
Initialize an addon-owned job with `--recipe asset-preparation`; it copies all
cases, parameters and required/additional assertions and pins the recipe. Use
`--case` only to select named recipe cases. The recipe is not an exporter or
native adapter. Keep the current functional candidate separate from
art proposals. A Blender render is useful design evidence, not imported parity.

```powershell
python tools/workflow.py init --recipe asset-preparation --project '<QA>/addon.gproj' --world 'Worlds/Tests/Asset.ent' --adapter '<addon>/qa/adapter.py' --executable '<python.exe>' --addons-root '<QA-parent>' --output '<addon>/qa/asset-job.json'
python tools/workflow.py plan --job '<addon>/qa/asset-job.json'
```

Review the copied purpose/subject placeholders, thresholds and adapter capability
before execution. Declare actual native fixture classes with `--required-class`;
static class presence still needs fresh native compile/load in the correct script
module. Initializing or planning starts no application.

## One source contract before modeling

Keep this in the addon's existing source manifest/QA record, with explicit
unknowns rather than invented defaults:

| Contract | Record and challenge before export |
| --- | --- |
| Identity and scope | Source hash, current functional commit/build, donor prefab/skeleton/graphs, selected regional change and protected object/face/material identities. Rebase selected regions, not an old whole carrier. |
| Reference attribution | Variant/date, correct side, configuration/pose, camera/pitch/foreshortening, landmarks, measured versus inferred dimensions and confidence. Withdraw a wrong attribution while retaining its original evidence. |
| Space | Units and physical bounds, source/export/native axis conversion, handedness, origin and each moving/collision pivot in its parent frame. Export an asymmetric axis/length sentinel and compare its native orientation and dimensions. Do not fix apparent scale by eye. |
| Behavior ownership | Object-to-bone/component/slot/compartment mapping, bind/rest and evaluated transforms, current animation graph/controller, full intended motion/crew envelopes. Resolve static versus moving ownership before refining a housing. |
| Geometry | Named visuals and LOD membership, collision name/owner/layer/metadata sets, UV/corner/normal/weight witnesses and preservation tolerances. Record source and decoded native precision separately. |
| Materials | Exact material consumers and slots, native resource bindings, texture suffix/profile, color space/channel packing/normal convention, tiling and both skins/variants. Preview nodes do not establish engine shading. |
| Export | Blender and official Enfusion Tools versions, actual exporter/settings, selected hierarchy closure, modifiers/triangulation, custom properties, armature/leaf-bone and animation policy, output manifest. Hash settings and semantic payload, not just the process exit. |

Use a tiny asymmetric fixture with one moving child, one collision owner, two
material slots and intentional near/far LOD differences before exporting a whole
vehicle or city kit. Retain its expected source manifest and compare the same
name/owner/transform/material/LOD contract after native import and cold reopen.
The historical source/FBX pass followed by **200 expected versus 193 cooked
colliders** demonstrates why a successful build message is insufficient.

Reopen a saved disposable source in a fresh supported process. Check both local
bind/rest values and evaluated poses; a dependency-graph refresh can explain a
stale world-matrix cache without authorizing changed local geometry. Preserve
the raw failed observation and the evaluated comparison. Never refresh the
baseline guard to make a candidate pass.

## Deterministic export and native parity

Export the frozen fixture twice to separate fresh directories. Require equal
declared selections, names, hierarchy, units/axes/pivots, geometry/corner data,
material slots, collision metadata and animation intent. Compare bytes where the
exporter promises stable bytes; otherwise retain both hashes and explain allowed
metadata differences with an independent semantic readback. Two agreeing exports
can share the same omission, so also compare both with the expected source set.

Challenge nested-only collections, duplicate names, hidden/reference meshes,
missing animation, collider origins, thin/invalid convex shapes and unmapped
materials. Use the official version-matched
[FBX import contract](https://community.bistudio.com/wiki/Arma_Reforger%3AFBX_Import)
and [car sample metadata](https://github.com/BohemiaInteractive/Arma-Reforger-Samples/blob/main/SampleMod_NewCar/Assets/Vehicles/Wheeled/SampleCar_01/SampleCar_01.xob.meta).
Donor animation graphs, wheel pivots, lights/windows and compartments are a
separate functional contract: a drivable render can still inherit wrong behavior,
as the firsthand [M35 conversion account](https://tetet.de/arma/reforger/Converting%20the%20Unsung%20M35%20truck.pdf)
illustrates. Do not remove all graphs to eliminate one inherited feature.

Qualify material/texture import using version-matched
[texture guidance](https://community.bistudio.com/wiki/Arma_Reforger%3ATextures),
then inspect forced individual LODs and continuous distance/FOV/resolution sweeps
using [LOD](https://community.bistudio.com/wiki/Arma_Reforger%3ALevel_Of_Detail)
and [model performance](https://community.bistudio.com/wiki/Arma_Reforger%3AModel_Performance)
guidance. Record actual supported readbacks; otherwise active LOD/residency is
NOT_TESTED. Triangle counts and a single near render are not memory/FPS evidence.
Replay current powered movement, crew access, optics, firing and moving subsystem
checks after import. Swept static poses alone do not establish runtime behavior.

## Optional preparation tools and stop conditions

[BK add-ons v1.5.0](https://github.com/steffenbk/bk-reforger-blender-addons/releases/tag/v1.5.0)
is an optional preparation candidate. Parent-supplied tagged-source review found
a differing non-convex-face check, a nested-only collection skip and disabled
animation baking in its batch path. Treat these as challenge fixtures, not
observed runtime failures. Verify the actual release archive, initializer/plugin
versions, provenance and license before any separately authorized installation;
the reviewed tag's initializer version differs from its release label. Its QA
does not replace official export/native acceptance. No plugin execution is part
of this recipe's validation.

If Blender or a DLL is denied by system policy, leave source/export/native gates
NOT_TESTED with the exact denial. Continue provenance, reference and saved-record
review. Do not retry through another binary/DLL, install, policy change or render
substitute. A reference board must say whether pixels are native, Blender or a
diagram; visible approval and technical qualification remain separate decisions.
