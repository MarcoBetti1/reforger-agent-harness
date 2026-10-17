# Opt-in concurrent Windows runtime leases

`tools/windows-runtime-leases/` contains a standalone Python3 stdlib coordinator and PowerShell5.1/CMD launcher prototype. It supports one user-review lane and at most two background-QA lanes, each with separate addon/profile/log/download paths. Background launch is hidden, requests no focus/backend and caps1280x720 at30FPS. It has no OS input/focus or force-stop helpers. The coordinator verifies executable, PID, process birth and parsed exact path arguments; PID or executable alone is insufficient ownership proof.

Migration is disabled by default. The example build configuration is intentionally incomplete. The launcher always dry-runs unless `-Execute` is provided; `-ValidateOnly` also forces a dry run. No existing client/server launcher is redirected to this prototype.

```powershell
tools/windows-runtime-leases/Launch-Runtime607.cmd -BuildConfig C:/IndependentBuild/build.json
tools/windows-runtime-leases/Launch-Runtime607.cmd -BuildConfig C:/IndependentBuild/build.json -Background -ValidateOnly
python tools/windows-runtime-leases/test_runtime607.py
```

The Windows fixtures use fake native executable files, real named mutex/file locks and cross-process races, actual CMD/PowerShell parsing, and a read-only CIM query of the test's own Python helper. They never start a game. Running the CIM fixture requires a shell permitted to query that helper. Output under `fixtures/`, `state/` and the result JSON stays ignored.

Choose one central registry/configuration for all participating controllers. Replace placeholder build roots, installed executable paths, addon/world and exact frozen manifest hash/count. Assign a host-local registry UUID. Inspect existing legacy owner state without altering it; wait for its actual owner to release. Only then explicitly enable migration. Preserve legacy serialization for launchers that have not adopted this coordinator. Registry activation does not make an old launcher concurrent.

Transactions use a named mutex plus an exclusive legacy handle. The compatibility bridge is written before registry claim; final release writes the registry before clearing the bridge. Interrupted/ambiguous records remain busy. A lease is marked starting before process creation; a crashed controller with a possibly unattached child is not automatically reclaimed. Successfully missing running PIDs may retire stale leases; unknown queries, reused PIDs, malformed/duplicate records, mismatched paths and foreign bridges fail closed. A private owner capability is required for release, and a live process cannot be released. Never commit owner receipts or coordination state. There is no force-clear command.

Offline fixture success is not native simultaneous rendering/performance or gameplay acceptance. Before adoption, qualify actual startup, attachment, natural closure/owner release and resource use with the selected native builds. An unrelated user game or editor remains outside this coordinator's authority. The flags/capability contract is enforced by this wrapper, not an OS security sandbox. Preserve actual physical public-input paths as final gameplay gates.

The generic recovery611 revision also rejects malformed scalar launch arguments before a claim or process start, preserves Windows paths ending in a backslash when quoted, and creates private receipt outputs exclusively. Existing receipts and coordination destinations are refused before claim; a final persistence failure retains a busy reservation. The historical607 filenames identify the schema lineage. This hardened generic revision is a separate successor, not a silent change to any frozen project launcher or live registry.
