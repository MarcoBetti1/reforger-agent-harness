# Reforger harness instructions

This repository contains reusable local test tools and research notes, not an addon. Read `docs/harness-handoff.md` and `docs/operations-playbook.md` before operating Workbench or Reforger. Keep observations separate from Workshop descriptions, and update the playbook after verifying or failing a UI step.

- Keep addon scripts, worlds, audio, recordings, and addon-specific probes in their own repositories.
- Use explicit `--project` and `--world` when opening Workbench. The default project may be an older local sample.
- Launchers dry-run by default; opt into each real run with `--execute`.
- For trusted local addon tests, `workbench:open --authorize-local-test-scripts --execute` supplies Workbench's `-scriptAuthorizeAll` switch, avoiding the script-refresh prompt during F5. This does not authorize arbitrary external code.
- Keep clean client and server profiles under `.cache`; never commit them or personal configuration.
- Rebind a fresh editor/game window after a launch or transition. Observe, send one input, and observe again. Avoid blind coordinate retries.
- A compile, pack, server `GAME` state, or log event alone does not demonstrate gameplay. Pair deterministic logs with visible behavior and video when testing an addon.
- The dedicated server may fetch a Workshop mod into its own profile. That does not register the mod in the client's Host Mods list. A real in-game Workshop download did register it in the observed Raven test.
- The automatic local dedicated-server join previously timed out during authentication even without mods. Use direct-world or Workbench F5 tests unless the join is independently verified.
