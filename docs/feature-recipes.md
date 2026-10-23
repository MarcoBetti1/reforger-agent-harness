# Feature-recipe index

Read this before a new subsystem, then use the [research/reuse workflow](workflows.md#research-and-reuse-before-implementation).
These are leads and bounded lessons, not blanket feature acceptance. Addon-owned
records remain authoritative for exact paths, hashes, commands and newer results;
resolve them through the current addon handoff/local registry. Do not run an old
binding against a new candidate or copy private caches into this repository.

| Feature | Reuse first | Evidence boundary and next test |
|---|---|---|
| Vehicle smoke | Compare an existing dispenser dependency with stock smoke and minimal original glue. GEP-015 inspected WCS Armaments 8.4.0 (`629B2BA37EFFD577`), RHS and stock AN-M8. | Source/static candidates exist; **UNRESOLVED** native launch/activation, coverage, rearm, MP/JIP and fitting. WCS permission for the proposed adaptation is unresolved. Test an ordinary stock grenade control, then one custom-launched round before a salvo. |
| Track movement audio | Stock track recordings exist; inspect native graph/signal routing and the official car-audio example before authoring a new audio system. GEP033 inspected Bradley/SpaceCore routing. | **UNRESOLVED** audible graph: signal-only prefab and JSON contract produce no new sound. Native resource GUID/graph compile, units, loop lifecycle, cabin/distance behavior and human audition remain required. Keep accepted stock audio meanwhile. |
| Driving | Use the existing [native course](driving-review.md), [mobility cases](../examples/workflows/mobility-cases.example.json) and `tools/driving_review.py`. | Existing measured recipe requires powered signed progress, actual action/contact overlap and grounded final dwell. **UNRESOLVED** slope/slip/solver semantics, ordinary keyboard, post-hit and MP are separate domains; do not tune physics to an unqualified getter. |
| HUD/optics | Inspect installed `SCR_WeaponInfoVehicle`, `SCR_2DOpticsDisplay` and `SCR_2DOpticsComponent` lifecycle before replacing the native display. GEP HUD shared fixes are recorded at `631f887` + `b18b319`. | Source review found cabin/ADS visibility scope mismatch and partial-widget retry/cleanup gaps. **UNRESOLVED** native acceptance in that handoff; schematic previews are not captures. Test cabin/ADS, firing/range miss, menu/seat/exit/death/control loss and stock restoration. Ballistics/stabilization need separate evidence. |

## Assets and terrain

| Feature | Reuse first | Acceptance boundary |
| --- | --- | --- |
| Blender/source/export integration | [Asset preparation](asset-preparation.md), [semantic gates](asset-review.md), [asset cases](../examples/workflows/asset-preparation-cases.example.json), official importer/sample metadata | Compare the same source/export/native contract; check current motion/crew owners and actual material/LOD behavior. Static proposals and optional plugin QA remain separate from native acceptance. |
| Terrain and reference districts | [Terrain review](terrain-review.md), [terrain cases](../examples/workflows/terrain-cases.example.json), existing startup/visual/mobility fixtures | Keep imported data, source confidence, visual fidelity, ground traversal, coverage and performance separate. A local occluder effect or repaired normal resources do not fix distance-dependent overlay breakup or qualify a realistic map. |

## Smoke: preserve both investigations

The addon records `SMOKE015-HANDOFF.md`, `STOCK-FIRST-ASSESSMENT.md` and the
stock-only `HANDOFF.md` (2026-10-20) preserve the alternatives and static limits.
WCS has an existing dispenser manager/rearm path; a stock AN-M8 resource is not a
drop-in replacement for a WCS-specific projectile contract. Projectile TTL is not
useful smoke duration. Neither replicated counts nor a launch request proves a
cloud, concealment or late-join visibility. A later compile-repair receipt records
exact native `PerformAction` parameter names (`pOwnerEntity`, `pUserEntity`);
its staged fix explicitly leaves native retest NOT_TESTED.

The [WCS author page](https://reforger.armaplatform.com/workshop/629B2BA37EFFD577)
was accessible on 2026-10-21 and lists 8.4.0 / game 1.8.0.13, with documentation
pending and a developer-support Discord link. It restricts sharing/modification/
adaptation absent written permission. Keep the dependency option under evaluation;
do not infer permission or runtime qualification from installation. No private
Discord evidence or third-party assets are included here.

## Track audio: source route, not a completed graph

GEP033's `HANDOFF-GEP033.md` and `research/PROVENANCE.json` (2026-10-21) retain
stock `Sounds/Vehicles/_SharedData/Tracks/Rotate/` recording paths and index
identity, plus installed routing observations. WCS ACP/SIG/audio payloads were not
decoded or reused. The [official car ACP example](https://github.com/BohemiaInteractive/Arma-Reforger-Samples/blob/83f12390d3dd61ed834d379f621520ed9f1b891d/SampleMod_NewCar/Sounds/Vehicles/Wheeled/SampleCar_01/Vehicles_SampleCar_01_Engine.acp)
is pinned at `83f1239`; consult its actual terms before adaptation. Qualify one
native movement layer without doubling inherited rolling audio. Audition parked
throttle, slow/fast/reverse/turn/coast/stop at cabin/exterior/distance with
[loopback audio](loopback-audio.md) and motion telemetry; numbers cannot establish
sound quality. The JSON graph contract must never be renamed to ACP.

## HUD: reuse the functional baseline, check current selection

The addon `updates/hud702/HANDOFF.md` and `NATIVE-HANDOFF.md` distinguish shared
functional fixes from rejected A/B/C layouts, the sight703 visual successor and
an unapplied ballistic experiment. Read the current handoff before selecting a
fixture. The recorded public WCS wiki fetch failed; exact WCS controls/parity were
not established. Native lifecycle source, installed API docs and the actual
selected project provide the next evidence. Preserve stock information until a
complete replacement is visible in the correct local seat/camera scope; a range
readout does not demonstrate zeroing or stabilization.
