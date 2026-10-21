# Reforger harness instructions

This repository contains reusable local test tools and research notes, not an addon. Read `docs/harness-handoff.md` and `docs/operations-playbook.md` before operating Workbench or Reforger. Keep observations separate from Workshop descriptions, and update the playbook after verifying or failing a UI step.

Begin a new task with `docs/workflows.md` and `python tools/workflow.py templates`. Before designing a new subsystem, complete its research/reuse step: consult saved lessons and the `docs/feature-recipes.md` index, installed/official docs and examples, existing working mods and accessible community documentation. Prefer a supported maintained dependency or minimal adaptation when suitable; record why custom code is needed. Select a template and explicit required measurements before running. Use the addon-owned adapter contract and shared ownership mechanism; the coordinator never controls a game process. Keep incomplete functional assertions NOT_TESTED, and report blocking questions/uncertain ownership to the coordinating task immediately. Preserve frozen releases and manual publication ownership.

Diagnose and repair ordinary tooling/session failures within the authorized scope using `docs/workflow-recovery.md`; one failed command is not a terminal blocker. Preserve attempts and inspect uncertain outcomes before retrying. Permission denials, unresolved ownership and human-session restrictions remain real boundaries; continue independent source/research work without bypassing them.

Discover already configured private workflows with `python tools/workflow.py bindings`. The ignored `reforger-workflows.local.json` beside this file binds names to addon-owned jobs and evidence roots; it works independently of shell cwd. Use `plan --binding <name>` before `run --binding <name> --execute`. Missing bindings require explicit local setup, not guessed project paths. Never commit the local registry or private fixtures.

- Keep addon scripts, worlds, audio, recordings, and addon-specific probes in their own repositories.
- Use explicit `--project` and `--world` when opening Workbench. The default project may be an older local sample.
- Launchers dry-run by default; opt into each real run with `--execute`.
- For trusted local addon tests, `workbench:open --authorize-local-test-scripts --execute` supplies Workbench's `-scriptAuthorizeAll` switch, avoiding the script-refresh prompt during F5. This does not authorize arbitrary external code.
- Keep clean client and server profiles under `.cache`; never commit them or personal configuration.
- Rebind a fresh editor/game window after a launch or transition. Observe, send one input, and observe again. Avoid blind coordinate retries.
- A compile, pack, server `GAME` state, or log event alone does not demonstrate gameplay. Pair deterministic logs with visible behavior and video when testing an addon.
- The dedicated server may fetch a Workshop mod into its own profile. That does not register the mod in the client's Host Mods list. A real in-game Workshop download did register it in the observed Raven test.
- The automatic local dedicated-server join previously timed out during authentication even without mods. Use direct-world or Workbench F5 tests unless the join is independently verified.
