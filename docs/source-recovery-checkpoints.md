# Source recovery checkpoints

Keep source and small manifests in the appropriate project Git repository. Keep large original art, compiled native payloads and captures in separately retained artifacts with exact Library IDs, versions, SHA-256 digests and byte counts. Reference third-party dependencies by identity/license; do not commit their raw packages or extracted assets. This public harness contains only generic tools. Private project history and private artifact indexes belong in a separate project repository or a private retained Git bundle.

`tools/artifact-checkpoints/checkpoint_artifacts.py` creates an immutable, explicit text-file checkpoint without executing files or contacting any service. It refuses path escapes, binary/unsupported inputs, generated/private directories, owner receipts, recognized credentials and signed links. Every file requires a provenance declaration. This is a useful boundary against common mistakes, not a complete license/secret classifier: review the explicit selection before committing or pushing.

```powershell
python tools/artifact-checkpoints/checkpoint_artifacts.py create --root C:/Project --selection C:/Project/selection.json --output C:/Recovery/source-batch-001
python tools/artifact-checkpoints/checkpoint_artifacts.py verify --checkpoint C:/Recovery/source-batch-001 --manifest-sha256 EXPECTED_DIGEST
python tools/artifact-checkpoints/test_checkpoint_artifacts.py
```

The selection example shows the schema. Select files individually using POSIX paths relative to the chosen root. Supported provenance values are `original`, `metadata` and `license_notice`. The tool copies exact bytes, records an ordered tree digest and writes a completion marker last. An interrupted copy fails verification. Existing destinations are refused. Files are limited to2MiB each and32MiB total. Verify detects modified, missing and extra files. Record the returned manifest digest in Git and the retained artifact receipt; checking a mutable manifest against itself is integrity checking, not independent authenticity.

A recovery checkpoint records qualification; it does not promote source to an accepted native build. Distinguish draft, saved/fresh-reopened source, native compilation/readback, inspected native appearance and actual physical/public-input acceptance. Keep accepted source and future candidates in distinct directories and manifests. Record source hashes, parent native manifest, resource IDs, frame/material/UV contracts, exact build/tool versions and remaining gates with each handoff.

Before a cloud workspace switch or risky long batch: commit source/scripts/design decisions and the artifact index, create and retain a Git bundle when no suitable private remote exists, and verify the bundle from a second empty repository. After recovery: verify the retained digest, fetch into a new isolated checkout, restore large artifacts by exact identity, verify every referenced hash, and reconcile qualification before composing a native successor. Never restore directly over an active editor/build/profile or treat a historical delta as the complete asset set.

Git LFS is appropriate only after choosing the project repository's privacy and confirming that each large asset may be stored there and its storage budget is acceptable. Do not run `git lfs track`, install a new service, convert existing history or push large captures automatically. Existing retained Library artifacts plus small Git indexes provide recovery without those changes.
