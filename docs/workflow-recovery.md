# Recovery and manual handoff

## Repair recoverable failures before handoff

An ordinary command, shell, reader or session failure starts diagnosis, not a
terminal blocker. Read the exact error and inspect whether the action actually
ran. Check cwd, executable path/version, arguments, source/build identity and
current output/process/session state. Use the existing playbook and supported
alternative, apply a bounded correction and verify it; continue diagnosis when
needed. Retain the
failed attempt and what changed; avoid identical blind retries or weakening
acceptance gates. A later repair does not erase an earlier FAIL/NOT_TESTED result.

Examples already recorded in the [playbook](operations-playbook.md): resolve the
running PowerShell path instead of assuming one; replace an exclusive live-log
reader with the sharing-compatible snapshot tool; poll the same bounded recorder
after closed stdin instead of starting a duplicate; inspect the first addon
compiler error before chasing cascading base-game errors. Recover using owned
files/processes only. A stale tool handle can be rebound; an uncertain action
must be checked before any repeat.

Permission denials, security/integrity restrictions, unknown process ownership,
STOP/cancellation and a human-owned native session require their existing gates.
Do not bypass them, clear a lease from age alone or retry a denied operation
without materially new authorization/evidence. Report the exact boundary promptly
while continuing independent source/research work. If supported recovery is
exhausted, report attempts, retained evidence and the smallest concrete next step
using the handoff format below; never imply an unavailable query returned empty.

| Boundary | Meaning | Next action |
|---|---|---|
| Project/base dependency missing | Fixture setup error | Supply explicit installed addon roots; rerun plan before launching |
| Spawn class missing | Private QA omission | Add the existing proven class to the private fixture; preserve failed build; compile and load anew |
| Class found, compile still fails | Static scan is insufficient | Inspect installed module/inheritance/API; no gameplay verdict |
| Native GAME absent | Startup unqualified | Inspect current console and world/addon identities; preserve error/crash evidence |
| Healthy turret, loaded muzzle | Component observation only | Measure traverse, elevation, actual rounds/projectiles and ordinary access independently |
| Scripted exit succeeds | Engine action path only | Test ordinary hatch/exit/reentry and controls when claiming human usability |
| Controls set, vehicle moved | May be overwritten controls or gravity | Observe controls before physics, RPM/gear, facing and signed powered intervals |
| Supply delivered, spacing failed | Useful outcome plus strict FAIL | Retain both; do not relax the gap or replace original actors |
| Native schema/attribute exception | Fixture/infrastructure may be broken | Check actual serialized class and inherited fields; stop before interpreting gameplay |
| UI input failed before delivery | No delivered-input evidence | Rebind fresh window and positive control; stop repeated blind retries |
| Capture is stale/loading | Image evidence invalid | Keep render workspace active, hide specific overlays, require actual clean frames |
| Canceled/deadline reached | Censored behavior | Cooperatively close only owned fixture, verify exit/release; no next case |
| Adapter remains alive/identity differs | Ownership uncertain | Preserve receipt/lease/process, report exact blocker to coordinator, await reconciliation |
| Lease PID absent | Possible stale ownership | Fresh successful inventory plus reservation/controller/parallel-owner review; no expiry-based release |
| CIM or filesystem query denied | Unknown infrastructure state | Report unavailable capability; never substitute an empty result |
| Export exceeds upload limit | Delivery preparation failed | Use full-resolution bounded JPEG export, preserve originals and inspect decoded outputs |
| Publisher validation rejects title | Local form validation | Prepare a plain descriptive title, preserve fields and let owner review actual current rules |

## Compile, package and native load

Use the existing `workbench validate/pack`, explicit project/world and separate logs/output. Compile covers scripts; native world load covers serialized fixture attributes/classes. Keep `addon.gproj`, `data.pak`, `resourceDatabase.rdb` from one build and pin all three. Include required notices and dependency identities in the release manifest. A pack's exit code is insufficient; the existing helper also checks a fresh nonempty PAK and packaging-success log. Keep source closed while editing; freeze every loaded package/source tree until its renderer exits.

## Renderer and human session

Normal closure, exact identity, lease release and the scenario verdict are separate checks. A user review window must be explicitly untimed (`--keep-open`) with a clear owner and human close instructions. Cancel automation before handing over. Never send an automatic late close, stimulus or publisher action into a human session. Coordinate all renderer owners; source-only concurrency tests do not qualify simultaneous native rendering.

When blocked, report: exact requested action and target; reason/source; what completed; denied, pending or uncertain outcome; current owned process/lease; and the concrete safe next step. Put the same blocker in the top-level task milestone immediately. Do not hide a required question inside a child task or repeatedly narrate an unchanged poll.

## Release handoff checklist

Save a frozen package manifest and notice/dependency audit, tested scope and missing acceptance, Git revision/CI, description/title, preview and screenshot byte/dimension/hash receipts. Check decimal limits with margin; do not assume MiB equals MB. Preserve originals and reference provenance. Clean public source excludes private QA/raw assets, chats, profiles and machine-specific paths.

The publisher remains manual and user-owned. Present current item/owner, visibility, license/terms and final assets for review; never infer publication from preparation, a local validation warning or a single click. Check the latest STOP/cancellation before any new external action. No command introduced by this workflow submits, accepts agreements, or publishes.
