# Start a mod task here

Use the existing harness as the entrypoint. Keep vehicle scripts, fixtures, worlds and scenario-specific reporters in the addon project. Python 3.11+ runs the small coordinator without extra packages; Pillow is needed only for image export/review. Native tests require the installed game/tools and a qualified addon-owned adapter.

```powershell
python tools/workflow.py templates
```

| Change requested | Template | First useful evidence |
|---|---|---|
| New project, compile/package/launch | `startup` | Explicit project/world, dependency graph, native serialized-world load |
| Projectile/fragment/component/crew damage | `damage` | Fresh subject, authored native stimulus, contacts/callbacks, before/after zones |
| Tracked handling/reverse/slope/traction | `mobility` | Powered signed progress, actual speed, gear/RPM and contact surface |
| Crew/hatch/optics/input | `crew-input` | Original occupied seat, completed transition, restored controls |
| Model/export/material/lighting/reference | `visual` | [Source/export contract](asset-preparation.md), native parity and matched pixels |
| Terrain/reference district/roads/crossings | `terrain` | [Data, visible quality, ground routes and coverage](terrain-review.md); `startup`/`visual` for repairs/controls |
| Cannon/engine audio | `audio` | Provenance, one-shot event ledger, native cadence/distance and human audition |
| Supply/following/Hold/Resume | `convoy` | Original actors, conserved native quantities, per-link gaps, dwell and fresh departure |
| Release preparation | `release` | Frozen trio, notices/dependencies/images, Git/CI and manual handoff |

Templates define minimum assertions and recommended additions, not complete acceptance for every feature. Add the recommended assertions needed for the actual request. For a post-hit usability claim, require **actual traverse, firing, exit, reentry and restored use**. Health, a loaded muzzle or a successful exit request cannot replace them.

Qualify native input on a healthy control before attributing a damaged-function failure. A clean free-camera fixture can have inactive ordinary ADS/input context even with a controlled seated actor. Use the ordinary player camera for input stages, require actual readiness and physical direction/ammunition changes, then restore the clean camera for photographs. Never use an angle/pose setter as powered-traverse evidence. See the [measured comparison](workflow-audit.md#representative-validation).

## Research and reuse before implementation

Before writing a new subsystem, answer **what already implements this, and what
is the smallest supported change?** Keep a short research/decision note in the
addon's existing research or handoff record; do not create another harness or
copy private evidence into this repository.

1. Read applicable `AGENTS.md` and `.agents/skills` where present, the addon's saved
   lessons/failed attempts, this [recipe index](feature-recipes.md) and the relevant
   [playbook](operations-playbook.md) section. Find existing jobs with `bindings`.
2. Consult installed API/base-game source, current official docs and official
   examples, then inspect an existing working mod and accessible community
   documentation for the feature. Use the [source tools](knowledge-sources.md#feature-research)
   and bounded reads. A description or resource name is a lead, not behavior proof.
   Record unavailable sources and use supported alternatives; never invent private
   Discord access, an API, a resource GUID or a successful test.
3. Compare stock/configuration reuse, a maintained dependency, minimal licensed
   adaptation and custom implementation. Dependencies are encouraged when they
   fit: check supported extension points, actual version/dependency graph,
   maintenance/compatibility, license/permission and packaging impact. Installation
   alone grants no copying/adaptation rights. Explain the choice and remaining
   gap before custom code; avoid rebuilding a proven subsystem by default.
4. Define the smallest discriminating test with the selected template.
   Reuse a proven fixture/control before changing its geometry or observer. Keep
   authority, input, visible behavior, audio, MP/JIP and lifecycle claims separate.

The same addon-owned note should retain: source URL or exact local resource plus
version/commit/hash and access date; license/permission assumptions and unknowns;
options and chosen reuse boundary; failed approach, evidence and reason for the
next changed attempt; repeatable commands and expected measurements; actual
PASS/FAIL/NOT_TESTED results; and the **exact runnable artifact** (current project,
world, adapter/job or binding, source/build manifest, dependency identities and
launch/test command with working directory). A proposal, inert graph contract or
dry run must say what is missing before it can run. Update the existing record
after testing, and add only a reusable lesson/link to the index when warranted.

## Initialize a saved asset or terrain recipe

Use `init --recipe asset-preparation` for the visual asset matrix, or
`init --recipe terrain --stage whole-map-load`, `surface-diagnostic` or
`playable-reference-block` for separate terrain jobs. Supply the same explicit
project/world/adapter/executable/addons-root/output flags shown below; full
commands are in [asset preparation](asset-preparation.md) and
[terrain review](terrain-review.md). The template is inferred. An explicit
conflicting template, missing stage, unknown/duplicate case or malformed recipe
fails before creating a job.

The initializer copies all cases, purpose parameters and full required/additional
assertions into the existing job schema. `--case` selects known recipe cases;
it cannot invent a case while silently dropping its extra gates. The recipe is
hash-pinned in `requiredFiles`; edits during initialization or before planning
reject. Initialize a fresh job after reviewing a changed recipe. Existing
`--template` jobs still work. Planning and the inert scaffold do not qualify a
native adapter; replace purpose placeholders with real measurements/thresholds
and follow normal source/capability/lifecycle admission before execution.

## Create and parameterize one job

First check for an existing qualified local adapter:

```powershell
python tools/workflow.py bindings
python tools/workflow.py plan --binding addon-functional
python tools/workflow.py run --binding addon-functional --execute
```

The default registry is the ignored `reforger-workflows.local.json` beside the
harness AGENTS.md, resolved from the tool location rather than the shell cwd.
Install it from [bindings.example.json](../examples/workflows/bindings.example.json)
with machine-local job paths, descriptions and output roots. `--registry` selects
another explicit registry. Relative registry paths resolve beside that registry.
Registration is an alias, not native qualification or process authority: planning
and all existing adapter, source, lifecycle and measurement gates still apply.
The saved plan records the actual resolved job and its pins. A named run without
`--output` creates a UTC/UUID directory below its registered output root and saves
the resolved output path in `summary.json`. Explicit `--output`, case selection,
dry runs and cancellation retain the same behavior. Direct `--job` runs still
require an explicit output path. Keep private adapters/fixtures/evidence in a
persistent addon workspace; preserve archival evidence independently.

When no suitable binding exists, initialize a new addon-owned job:

```powershell
python tools/workflow.py init --template damage --project '<private-QA>/addon.gproj' --world 'Worlds/Tests/Damage.ent' --adapter '<addon>/qa/adapter.py' --executable '<python.exe>' --addons-root '<private-QA-parent>' --addons-root '<installed-game>/addons' --required-class 'MyDamageFixture' --case rifle-right --case fragments-front --output '<addon>/qa/damage-job.json'
python tools/workflow.py plan --job '<addon>/qa/damage-job.json'
python tools/workflow.py run --job '<addon>/qa/damage-job.json' --output '<evidence>/batch-01'
python tools/workflow.py run --job '<addon>/qa/damage-job.json' --output '<evidence>/batch-01' --execute
```

`init` creates a local JSON file with exclusive creation; review it before execution. Set each case's `parameters`, add acceptance assertions, pin critical files with `requiredFiles` (`path`, optional `sha256`), and declare fixture classes in `requiredClasses`. Use the supported interpreter's exact path; the system Python alias or a different PowerShell can have different availability/policies. A PowerShell adapter uses the same positional request/result/cancel arguments, through `-File`. No execution-policy or security change is part of this workflow.

All job paths resolve relative to the job file, so a fresh task does not depend on its shell working directory. `sourceRoots` are actual source addon roots. `addonRoots` are the selected project or parent folders containing immediate addon subfolders, including installed base-game addons. Discovery is bounded to these roots and one subdirectory. Duplicate GUIDs and missing transitive dependencies stop planning. Packed dependencies require a nonempty PAK and resource database. The planner checks declared class definitions and required files, then pins their hashes, the unique resolved world automatically, project/dependency files, job, template, adapter and interpreter. World resources must stay relative to their source roots after GUID removal; ambiguous/escaping worlds are rejected.

This is a static preflight. It cannot establish script scope/configuration, inherited world attributes, actual resource GUID resolution, native compilation, behavior or the semantic correctness of a class. Require fresh native compile/load evidence before interpreting gameplay. Pin a complete addon manifest and have the adapter verify its closure; `requiredFiles` alone is not a complete source-tree freeze. The planner does not extract proprietary packages or infer undocumented APIs.

## Run and read evidence

Each selected case gets a fresh request UUID, directory, command, stdout/stderr, normalized result and hashed evidence references. The saved plan pins inputs and required assertions. Inputs are checked again before and after each case. Adapters must also freeze and verify their full native fixture/build. The coordinator invokes an argument array without a shell and runs cases sequentially. It never starts/closes Game directly or claims a renderer lease.

Execution requires 2 GiB free on the resolved output filesystem before creating a batch. This is a preflight, not a reservation; adapters must check every native profile/log/download filesystem too. A stdout or stderr log above 64 MiB requests cooperative cancellation and stops the batch. It is a detection boundary, not a hard write quota when an adapter ignores cancellation; preserve and report that owner.

Open `index.md`, then `summary.json`, then a case's `result.json` and original evidence. A scenario can be `FAIL` while its infrastructure and lifecycle pass. A missing measurement is `NOT_TESTED` with a reason. Malformed adapter types or nonfinite numbers produce normalized infrastructure results. `attempted`, `notStarted` and `incomplete` distinguish an attempted case from a case with no durable normalized result. An infrastructure error cannot become a mod failure. Normal exit is a separate lifecycle result. A behavior PASS with unresolved closure leaves the batch NOT_TESTED and prevents the next launch. Strict failures and all retries remain in their original directories; no automatic retries or threshold changes occur.

An adapter is trusted local executable code. Schema validation and hashes establish identity and completeness, not truth. Review raw native measurements, callbacks, screenshots/video and source provenance before claiming acceptance. CI exercises the coordinator with synthetic subprocesses; it does not run Reforger.

## Cancellation and human takeover

Create `<batch>/STOP`, pass `--stop-file '<shared-stop-file>'`, or interrupt the coordinator. It checks cancellation before every case, creates that case's run-specific `CANCEL` file while running, and gives the adapter `closeGraceSeconds` to report normal owned closure. The adapter must implement the file protocol and keep watching cancellation during startup, play and close. A cancellation/deadline censors the behavior result even if a terminal file arrives later.

The coordinator never kills the adapter or a game process. If the adapter is still alive after the grace period, the batch stops and records uncertain ownership. Preserve its process, receipt and lease. A coordinating task must receive the exact action/target/reason, completed work, pending/denied/uncertain state and concrete next action immediately; a child-only question is insufficient. Do not launch another case until fresh ownership/closure is reconciled. A later normal exit does not retroactively turn a canceled test into PASS.

For read-only admission diagnosis on Windows:

```powershell
& tools/runtime_status.ps1 -Lease '<shared-runtime-slot.json>'
& tools/runtime_status.ps1 -Lease '<shared-runtime-slot.json>' -OwnerReceipt '<run>/owner.json'
```

The diagnostic mutates nothing. An old timestamp cannot prove a lease stale. Missing CIM access is unknown, not an empty process list. Even a missing PID requires reconciliation of the reservation/controller and all parallel owners. Full parsed argv equivalence, atomic claim/attach/release and normal close remain adapter responsibilities. Existing qualified exclusive adapters can keep using the same shared slot. The historical concurrent manager remains source/offline qualified; do not silently activate it or impose an exclusive guard over an explicitly authorized coordinated multi-session run. See [recovery](workflow-recovery.md).

## Native driving review

Use [driving-review.md](driving-review.md) and the [mobility recipe](../examples/workflows/mobility-cases.example.json) for the measured native course. Require frozen-heading net progress, power/action/contact overlapping actual motion, and grounded 3D terminal dwell. Curved path length, earlier stops or engine-on rest cannot establish powered driving. Slope/traction/solver getter semantics stay separate NOT_TESTED domains.

## Native visual and upload preparation

Use [asset semantic gates](asset-review.md), [clean visual review](clean-visual-review.md), `visual:capture` and `tools/native_capture_review.py` with the existing native camera protocol. Batch views in one qualified scene; reset subject/physics where required. Pin actual map/world IDs and inspect placement/occlusion, clean HUD, muzzle/gun clipping, loading-frame rejection, camera pose and matched actual exposure. Hiding an entire UI workspace can stop rendering; use the verified scene-specific overlay controls. Ground pixel brightness is not a lux or recognition-distance measurement. Run `tools/compare_visual_reviews.py` before treating two retained review manifests as matched pairs; it compares actual conditions and image hashes while keeping manual visual acceptance pending.

```powershell
python tools/export_upload_images.py --image '<native>/shot-01.png' --image '<native>/shot-02.png' --output '<evidence>/upload-01'
python tools/export_upload_images.py --image '<native>/shot-01.png' --image '<native>/shot-02.png' --output '<evidence>/upload-01' --execute
```

The default strict ceiling is 4,800,000 decimal bytes. It searches JPEG quality 100 down to the declared floor, retaining dimensions/framing and 4:4:4 chroma; it refuses transparent originals, resizing and overwrite. The manifest records original/export hashes, encoding quality and measured pixel difference. JPEG is lossy; archive the native originals. Inspect actual exported images. Partial failures retain their receipt and completed files. Publication remains a separate human action.

## Fresh task handoff

Record one current entrypoint, job path/hash, exact fixture/package identity, selected cases/assertions, evidence index, measured verdicts and missing measurements. Include the current owner/lease and whether a human window is open. Link old attempts as history instead of stacking contradictory “current” paragraphs. Use milestone updates for new findings, changed plans or blockers; avoid per-poll narration. See [audit and validation](workflow-audit.md) for the observed reasons behind these gates.

## Asset preparation and terrain work

Use [asset preparation](asset-preparation.md) before modeling/export, and
[terrain build/evaluation](terrain-review.md) before map generation or repair.
Both reuse this entrypoint, addon-owned jobs, existing semantic/camera tools and
separate domain verdicts. Their case recipes are specifications, not executable
adapters or qualified fixes. The [retrospective](asset-terrain-retrospective.md)
links the observed failures and the non-native validation boundary.
