# Build and evaluate terrain in small, repeatable layers

Keep the current [workflow entrypoint](workflows.md). Use `startup` for an import
or whole-map load, `visual` for a causal rendering control, and the `terrain`
template for a representative playable block. Start with the
[terrain case recipe](../examples/workflows/terrain-cases.example.json). These
are specifications for addon-owned generators/reporters and existing native
fixtures, not a new terrain generator or an admitted native adapter.

## Freeze the geographic and generation contract

Record source URL/date/license and file hashes, horizontal CRS/axis order/bounds,
vertical datum/units/range/offset, source DEM resolution, imagery/mask resolution,
sample dimensions and whether dimensions count vertices or faces, lattice spacing,
world origin and physical extents. Confirm at least three independent landmarks
and measured separations after import. For a regular vertex lattice, extent is
`(vertexCount - 1) * spacing` along each axis; explicitly document any format's
different cell convention. The firsthand
[heightmap size/area mistake](https://forums.bohemia.net/forums/topic/242586-heightmap-help/)
is a useful negative fixture. Finer resampling does not add surveyed elevation
detail or repair an unknown datum.

Preserve raw DEM, source roof/road/water/protected-feature records and immutable
IDs. Keep separately regenerable height edits, surfaces/masks/satellite, road
topology, crossings, inferred building lots/courts, architecture, props and QA
fixtures. Pin generator version/configuration/seed and intermediate hashes;
rebuild twice into fresh destinations and compare semantic output/stable IDs.
Record which edit invalidates downstream layers instead of rebuilding everything.
The author's [base-map generator](https://github.com/tubalainen/arma_reforger_base_map_generator_ng/)
offers a useful separation of input layers, not a recommendation to install/run it
or a guarantee of source accuracy.

Keep sourced, inferred, creative and unknown fields distinct. A roof polygon is
not automatically a lot; carving a court changes its interpretation. Record
area/height/occupancy and court losses per coverage cell. Unknown use, missing
elevation, special buildings and landmarks remain HOLD for automatic assignment.
One modern residence or monumental arcade cannot establish city-wide frequency.
Define locally researched courtyard/party-wall/setback/entrance/roofline/street
rules and geographically specific exceptions before expanding a family. The
production [environment interview](https://reforger.armaplatform.com/news/interview-with-jan-buchta)
describes why architectural context and gameplay design both matter.

## Two evaluations, separate verdicts

First load the rough whole map: extents, tile seams, missing resources, connected
road/water structure, distant representation and representative memory/frame-time
load. Then develop one sourced reference district with coherent connected streets,
frontage, courts, entrances, walls and a river crossing where relevant. Do not
polish a few flyover views while the rest of the map has no coverage.

Keep these rows separate in the addon's existing result ledger:

| Domain | Minimum useful acceptance |
| --- | --- |
| Imported data integrity | Expected tile/sample/name/resource sets, dense native heights versus declared source conversion/tolerances, stable source IDs, missing-resource logs, save/cold-reopen. PASS says nothing about attractiveness or playability. |
| Geographic/source confidence | Landmark positions/separations, datum/extent, source versus invented topology and district rules; unknowns remain explicit. A correct OSM graph does not prove native traversal. |
| Native visual fidelity | Raw matched near/mid/far images plus actual camera/pose/environment/exposure, representative eye-level views, surface/normal/clutter/LOD behavior, facade scale and regional identity. Imported flags cannot substitute for pixels. |
| Playability | Grounded pedestrian and vehicle routes, corners/slopes/curbs, doors/courts, road-to-bridge-to-bank joins, collision and ordinary player control. Teleport endpoints and connected source nodes do not prove a traversable route. |
| Performance | Whole-map and reference-block load at pinned hardware/build/settings, warmup and repeated frame-time/memory samples along the same route. Compare distributions and budgets declared beforehand. One editor FPS readback or triangle count is not acceptance. |

The `terrain` template requires data, visual, traversal and coverage assertions.
For geographic/promoted-map or performance claims, copy the recipe's additional
required assertions too. An import-only repair belongs in `startup`/`visual`,
not a passing playable-terrain report. Each coverage cell records required views,
routes, risk class and PASS/FAIL/NOT_TESTED with reason/evidence; report the
untested denominator as well as the passing count. A grid is a reporting unit,
not evidence for district style. Sample high-risk crossings, tile edges, dense
blocks, open ground and slopes deliberately; reserve held-out cells for regression.

## Discriminating native controls before map-wide changes

Reuse the small saved pavement/normal fixtures. Freeze height/material/geometry
while varying one proposed cause. Require a visibly sensitive negative/control
before attribution: raised geometry can hide stones without any occluder effect.
Keep bare ground, unchanged repeat and A/B/A at the same location; inspect local
regions and temporal reversal. Whole-frame differences include exposure/UI/sky.
A local mask effect does not qualify generated roads, depth behavior or distance.

The retained normal control repaired 14 to 256 runtime normal maps, removed 55
observed missing-map warnings and preserved 4,260,096 native height samples
bit-exact, but **the curved overlay still failed visually**. Editor DDS output,
runtime resource rebuild and cold reopen are separate gates. Build output can
inherit old mtimes: use fresh run/build receipts, complete named outputs and
stable hashes, not mtime alone. Preserve failed watcher/compile/lifecycle receipts.

The official [terrain production tutorial](https://reforger.armaplatform.com/news/terrain-tutorial)
recommends about 2 m cells, leaving surface-type headroom per block, native road
integration and satellite refresh after roadwork. These are design leads, not a
diagnosis of the retained 6 m overlay. Prepare a small matched native-surface/road
versus overlay control, then a bounded 2 m/6 m representative comparison if
needed. Keep geographic footprint/source data and camera conditions comparable;
report expected sampling differences. Do not resample the whole map, lift
overlays arbitrarily or increase normal texture resolution to claim a height/LOD
fix. Actual engine LOD causation remains unproven.

Stop between experiments when control sensitivity, identity, cleanup or source
integrity is uncertain. Keep normal exit separate from recovery termination.
All native launches and UI remain with the admitted owner; this recipe changes
no ownership/security gate and supplies no new authoring API.
