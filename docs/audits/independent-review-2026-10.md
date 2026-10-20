# Independent local review

A fresh GPT-6.1 Sol agent on High reviewed draft PR #1 from initial revision
`0ed250e7d08a2ae61739d34f780841d2243e7b00`, independently ran tests and reproduced
failure cases. Review was read-only: no native renderer, lease, publisher,
GitHub review/comment or source mutation. This is bounded code/contract review,
not independent native execution or release certification.

| Finding | Consequence | Verified correction |
|---|---|---|
| Declared world was checked but not automatically pinned | Different world bytes could be used across a batch | Pin unique resolved world even with empty requiredFiles; reject ambiguity |
| Status container reached set membership before type check | An attempted case disappeared into notStarted | Strict types, normalized infrastructure result, explicit attempted/incomplete/unstarted sets |
| Exponent-overflow JSON and stripped-GUID path escape | Invalid numeric output or world outside declared roots | Finite parse_float and post-GUID relative/containment validation |
| Circular travel counted as signed progress | A circle could qualify forward movement | Net displacement on frozen phase-start facing; retain integrated path separately |
| Reverse/turns lacked their own power qualification | Unpowered motion could qualify maneuver acceptance | Actual power/action/contact gates for every claimed maneuver |
| Phase pooling accepted an early final-stop | A stop before motion could qualify terminal dwell | Contiguous single intervals in declared phase order |
| Powered rest and later unpowered motion combined | Aggregate power fraction falsely qualified movement | Require continuous, simultaneous power/action/contact and actual motion |
| Horizontal-only speed accepted a falling vehicle | Airborne descent qualified stationary dwell | Grounded 3D speed and position stability throughout terminal dwell |
| Offline CLI errors lacked a structured receipt; source read twice | Infrastructure errors resembled scenario FAIL; hash might cover different bytes | NOT_TESTED/exit2, exclusive receipts, one analyzed/hashed byte buffer |

All reproductions reject after correction. The reviewer independently ran
**67 Python tests**, all passing, and `git diff --check`. No additional false
PASS was found within the reviewed contracts. Native integration then exercised
the reviewed tools with real private addon adapters; see the
[validation receipt](workflow-validation-2026-10.json) and
[acceptance matrix](../workflow-acceptance.md).

The reviewer also identified the matched-pair visual gap: individual captures
could each pass while actual camera/light conditions differed. The new offline
comparator verifies original/decoded pixels and recorded conditions, matching
stations independently of label prefixes. Manual visual acceptance remains
pending. A template catalog is a routing/measurement contract, not an executable
native adapter for every addon; this limitation remains explicit.

Integration follow-up reviewed the minimal local binding registry and five CLI
regressions: registry-relative resolution, named adapter invocation/fresh output,
case selection, malformed/missing bindings and preserved explicit direct-job
outputs. **72 Python tests pass**. No unresolved correctness or public-data
hygiene blocker was found; readiness/merge remains gated on green CI and local
persistent-binding validation.
