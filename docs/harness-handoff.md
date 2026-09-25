# Harness handoff

This is the reusable control plane for Reforger addon work. Addon-specific code and evidence belong in their own repositories. Begin with `npm ci`, a private `reforger-agent.config.json` copied from the example, and `npm run cli -- doctor`.

## Fast test loop

1. Open a selected addon and test world with `npm run workbench:open -- --editor world --project '<addon.gproj>' --world '<world.ent>' --authorize-local-test-scripts --execute`.
2. Select the current World Editor window and watch the fresh log and viewport. The helper includes `-run`, which may start the loaded world's preview automatically; press F5 only if no GAME/probe startup appears after editor startup settles. The authorization flag maps to Workbench's `-scriptAuthorizeAll`, so the local refresh prompt is suppressed for this process.
3. Use an addon-owned deterministic probe to issue orders and report actual position/state evidence. Inspect the Workbench `script.log` and capture the view with `npm run screen:record -- --backend ddagrab --output-idx <monitor> --output '.cache/test-videos/run.mp4' --execute`.
4. Stop F5, validate with `npm run workbench -- validate --project '<addon.gproj>' --execute`, and pack with `npm run workbench -- pack --project '<addon.gproj>' --output '<separate output directory>' --execute`.
5. Preserve the world, exact inputs, before/after state, log path, recording, and observed result in the addon repo. Keep unknown behavior marked unverified.

The script authorization flag was exercised on this Windows installation. The Workbench run may still fail for a separate script or engine reason; inspect the current log and do not infer success from a dismissed dialog.

For an isolated vanilla or installed-addon Game Master test, use `npm run client:run -- --profile '.cache/client/profiles/test' --world 'worlds/GameMaster/GM_Arland.ent' --expect-game --execute`. `--keep-open` leaves the client available for a player; otherwise set `--duration-seconds`. A loopback Conflict server can be prepared with `conflict:host`, but client joining has not yet passed a live control.

Read [operations-playbook.md](operations-playbook.md) for the verified UI and CLI details, [knowledge-sources.md](knowledge-sources.md) for API documentation, and [raven-field-notes.md](raven-field-notes.md) for the completed third-party mod probe.
