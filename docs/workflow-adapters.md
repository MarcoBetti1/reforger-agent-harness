# Addon adapter contract

An adapter receives three positional paths: request JSON, result JSON, cancellation file. The coordinator supplies them as exact argument tokens, without shell interpolation. Do not parse stdout for the result. Save native evidence before publishing the result, through exclusive creation or an atomic durable replacement inside that fresh run.

Request fields: `schema: 1`, unique `runId`, `caseId`, `template`, exact `project`, `world`, fresh `attemptDir`, `assertions`, `parameters` and declared `capabilities`. Copy the request run/case identities into the result. Native fixtures should bind their own nonce/run ID, build/world/actors and terminal result; the adapter must verify that binding before translating it.

```json
{
  "schema": 1,
  "runId": "<exact request UUID>",
  "caseId": "rifle-right",
  "infrastructure": {"status": "PASS", "reason": "Fresh native GAME/ready/done and frozen fixture verified"},
  "assertions": {
    "fixture.ready": {"status": "PASS", "reason": "One original subject and conscious gunner"},
    "stimulus.native": {"status": "PASS", "reason": "Authored projectile and registered subject contact", "actual": {"issued": 12, "contacts": 12}},
    "damage.observed": {"status": "PASS", "reason": "Native subscribed damage callbacks retained", "actual": 12},
    "post-hit.fire": {"status": "NOT_TESTED", "reason": "This fixture has no post-hit firing stage"}
  },
  "lifecycle": {"status": "PASS", "reason": "Exact owned process exited normally and atomic lease release verified", "verifiedExited": true, "leaseReleased": true},
  "evidence": ["native-result.json", "console.log", "build-manifest.json"]
}
```

All statuses are `PASS`, `FAIL` or `NOT_TESTED`, each with a nonempty reason. `actual` is optional structured measurement. Missing required assertions are inserted as NOT_TESTED. The coordinator hashes every referenced evidence file; absolute external original paths are allowed for existing fixtures, so keep local indexes private. For a portable handoff, preserve/copy the referenced files and their manifest, then verify hashes. Never publish local private path mappings, raw chats, profiles, credentials or reference downloads.

Required adapter behavior:

1. Preflight installed executable/build, addon IDs, dependency roots, required classes and native compile/load. Pin the complete source or packaged trio and preserve it through closure.
2. Reserve the shared renderer coordination mechanism atomically; verify no conflicting session. Explicit coordinated parallel admission must account for every owner, isolated source/pack/profile/log/download paths, and resource headroom. Never silently migrate coordination schemas.
3. Spawn hidden for background QA, bind exact PID/executable/creation and parsed argv, and retain a private owner receipt. An uncertain attempted spawn retains its reservation. Never infer ownership from PID alone or a timestamp expiry.
4. Require actual GAME plus fixture readiness; reject editor-time initialization, duplicated probes/actors, stale terminals and source hot reload. Fresh process/subject per damage case is the proven baseline. Batched camera views may share a scene only when its reset contract is verified.
5. Exercise the real native pathway. Keep health setters/synthetic damage outside ballistic evidence. Preserve all received callbacks, dropped-count diagnostics, topology and authored ammunition. For driving, measure powered signed progress and world-time dwell; for supply, retain identities and conservation.
6. Watch the cancellation file throughout startup and play. Translate it to the **run-specific** native close protocol; no new stimulus/actions afterward. Verify normal exit and atomic lease release separately. Bound retries/recovery and report an unclosed or ambiguous owner instead of killing or replacing it.
7. Record gameplay, post-result and teardown diagnostics separately. Baseline-reproduced errors stay visible; they do not become mod defects by association, nor become harmless without evidence.
8. Emit the result file even for infrastructure errors when possible. Exit 0, 1 or 2 for qualified completion, scenario failure or incomplete test respectively. Other exit codes invalidate infrastructure. No result file is a retained infrastructure failure.

The public harness intentionally contains no vehicle probe or proprietary game data. Reuse the addon-owned native fixture and translate its existing structured result. Start with a single known-good native control, then one representative case, then a matrix. The cancellation and lifetime contract is part of qualification, not an assumption from unit tests.
