# Geometry and material changes

Use the `visual` template with a separate addon-owned asset fixture and the
[clean native camera workflow](clean-visual-review.md). Keep source preservation,
export/native readback and visible quality as distinct assertions. A successful
export or native build message cannot substitute for all three.

The retained effort provides concrete failure examples:

- A 200-collider source passed fresh reopen and raw FBX checks, then native
  cooking omitted seven shapes and produced 193 while also printing Build
  successful. Require the exact native name/owner/count set before gameplay.
- Small newly authored triangles changed decoded normals beyond their declared
  limit despite otherwise preserved source. Preserve the failed measurements;
  source, exporter and native numeric representations have different precision.
- A disabled material-detail control differed at a few display codes even when
  an unchanged-material repeat passed. Enabled detail was held. Do not dismiss a
  strict control failure as temporal noise or silently change its crop/tolerance.
- Native TextureDetail value zero meant Ultra in the inspected build. Numeric
  ordinals and complete cooked mip chains did not establish live mip residency
  or active LOD. Check installed UI/engine semantics rather than assume them.

Source fingerprints are in the [audit receipt](audits/workflow-validation-2026-10.json).
These observations do not establish universal degeneracy or shading thresholds.

Before editing, pin the original source/build, exporter/native versions, owner
names, face/corner correspondence and the exact allowed change set. Inventory
shared material/image consumers; a generic rubber/paint binding can serve many
unrelated faces and assets. Rematch selected current faces before application.
Do not replace newer runtime scripts with an older reference project's scripts.

Declare expected preservation and its tolerances before running:

| Gate | Evidence required |
|---|---|
| `geometry.semantic-preserved` | Oriented faces, local/world transforms, vertex/loop normals, UVs, weights, rig hierarchy/frames, actions and unaffected owners |
| `uv.valid` | Nonzero relevant UV area, intended texel density/coverage, seams and reflected islands; a shape preview does not prove UV readiness |
| `materials.binding-scope` | Exact target/shared consumers, protected image/material pointers, channel packing, color space and scalar/UV-selector readbacks |
| `geometry.native-topology` | Native imported shape/owner/name/count set, expected physics metadata, bounds and all intended visual LODs; retain omitted/rejected shapes |
| `lod.native-transition` | Near/far native views and motion through transitions; no active-LOD claim without a supported measured identity |
| `geometry.clearance` | Explicit reference frame/pose, signed gap/intersection and continuous motion/angle bounds where required; static clearance is not moving clearance |

Use addon-owned semantic exporters/readers matched to the actual format. A
round-trip importer can drop coincident faces or reinterpret typed normal data.
Record typed values and raw correspondence; do not refresh guards or normalize a
schema merely to accept a candidate. Fresh-process save/reopen and an injected
rollback failure are useful separate checks before native cooking.

After import, compare the native result against the declared source intent and
protected baseline. Keep exact source checks distinct from decoded native
tolerances. If a strict numerical failure appears visually small, retain both
facts and leave the failed gate visible until its acceptance contract is
explicitly reconsidered. Never call it numerically exact because an image looks
unchanged.

For visible material changes, start with unchanged and disabled-effect controls,
then enabled-neutral and candidate states, with matched camera/environment and
readback. Record image format, color space, compression and decoded mip chain.
Inspect close, medium, whole-asset, ordinary outdoor and grazing views, plus
motion if shimmer/clearance matters. Keep pixel values separate from lux and
physical material claims. Binary tangent certification, live residency, GPU
cost, full suspension and all extreme poses stay NOT_TESTED unless measured.

The repository supplies recipe/capture/comparison tools. Asset-format semantic
readers and native geometry reporters stay with the addon: an invented universal
mesh schema would not qualify those engine-specific facts.

Before authoring or export, use the [source/export preparation contract](asset-preparation.md)
and its [case recipe](../examples/workflows/asset-preparation-cases.example.json).
They connect these semantic gates to current functional ownership, reference
attribution, deterministic export and a small native parity fixture.
