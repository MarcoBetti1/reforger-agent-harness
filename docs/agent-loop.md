# Agent Loop

## Goal

Use Git plus an LLM agent to make small, testable changes to a Reforger mod without losing control of the source tree.

## Suggested loop

1. Create a branch for one requested change.
2. Point the agent at the mod path and the helper MCP server.
3. Ask the agent to inspect first, then propose a minimal edit plan.
4. Let the agent change only the required text files.
5. Review the diff.
6. Test in Workbench or in the game.
7. Commit if it works. Revert or refine if it fails.

## Suggested prompt shape

Use a prompt with these fields:

- target mod path
- requested behavior change
- files or folders to avoid
- acceptance test in plain language
- instruction to inspect before editing
- instruction to summarize exact changed files

## Example

```text
Target mod path: C:\Path\To\MyMod
Requested change: Reduce the respawn delay from 30 seconds to 10 seconds.
Constraints: Do not rename files. Do not change localization. Inspect first and explain which file controls respawn timing.
Acceptance test: When I die in the local test scenario, the respawn timer should show 10 seconds.
Output: List each changed file and summarize the reason for the change.
```

## Git rules

- One branch per change request.
- Commit before testing risky edits.
- Never edit packaged output.
- Keep the helper repo separate from the mod repo when practical.
