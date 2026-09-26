# Harness handoff

This is the reusable control plane for Reforger addon work. Addon-specific code and evidence belong in their own repositories. Begin with `npm ci`, a private `reforger-agent.config.json` copied from the example, and `npm run cli -- doctor`.

## Fast test loop

1. Open a selected addon and test world with `npm run workbench:open -- --editor world --project '<addon.gproj>' --world '<world.ent>' --authorize-local-test-scripts --execute`.
2. Select the current World Editor window and press F5 once. The helper's `-run` does not itself establish a live gameplay preview; test components can log initialization while the editor loads. Require a later `GAME` transition and gameplay-ready probe marker. The authorization flag maps to Workbench's `-scriptAuthorizeAll`, so the local refresh prompt is suppressed for this process.
3. Use an addon-owned deterministic probe to issue orders and report actual position/state evidence. Inspect the Workbench `script.log` and capture the view with `npm run screen:record -- --backend ddagrab --output-idx <monitor> --output '.cache/test-videos/run.mp4' --execute`.
4. Stop F5, validate with `npm run workbench -- validate --project '<addon.gproj>' --execute`, and pack with `npm run workbench -- pack --project '<addon.gproj>' --output '<separate output directory>' --execute`.
5. Preserve the world, exact inputs, before/after state, log path, recording, and observed result in the addon repo. Keep unknown behavior marked unverified.

The script authorization flag was exercised on this Windows installation. The Workbench run may still fail for a separate script or engine reason; inspect the current log and do not infer success from a dismissed dialog.

## Evidence gates for an addon run

- `workbench pack` checks a fresh, nonempty `data.pak`. A direct client launched with that pack and `--expect-game` checks only that the client entered `GAME`; verify the loaded world separately. Neither result proves an AI order, player input, or delivery worked. For gameplay acceptance, require a run-specific terminal result backed by measured movement, actors and seats, state, and a visual recording.
- In Workbench, a test component can initialize while World Editor loads. Start F5 or the observed Play control, then require a later `GAME` transition and gameplay-ready marker. Inspect the current run's `console.log` when the test gate also needs the world-load line; `script.log` may omit it. Exiting F5 can append another editor initialization, so report the actual gameplay session.
- Freeze addon scripts and test worlds from the start of a GUI run through F5 exit. Workbench can hot reload a saved script before F5 or during a preview. After a change, close the preview and editor, validate and pack, then launch a fresh editor or packed client with a fresh run directory. Preserve the pack identity used for each result.
- Record the selected monitor with `ddagrab` and inspect a few frames before relying on the MP4: named-window `gdigrab` returned a stale image on this machine. Wait for recording to finish before probing or clipping the file, because its MP4 index is written at close. A video supports what was visible; log telemetry supports off-camera state.

For an isolated vanilla or installed-addon Game Master test, use `npm run client:run -- --profile '.cache/client/profiles/test' --world 'worlds/GameMaster/GM_Arland.ent' --expect-game --execute`. `--keep-open` leaves the client available for a player; otherwise set `--duration-seconds`. A loopback Conflict server can be prepared with `conflict:host`, but client joining has not yet passed a live control.

Read [operations-playbook.md](operations-playbook.md) for the verified UI and CLI details, [knowledge-sources.md](knowledge-sources.md) for API documentation, and [raven-field-notes.md](raven-field-notes.md) for the completed third-party mod probe.
