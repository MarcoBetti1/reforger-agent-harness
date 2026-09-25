# Research Summary

## Reforger-side findings

- Arma Reforger mods are addon projects centered around `.gproj` files.
- Script loading is module-based. The important folders are under `Scripts/`, especially `Scripts/GameCode` and `Scripts/WorkbenchGame`.
- Workbench plugins exist and can automate editor-side tasks.
- The official samples repo is the best safe starting point for learning structure and common patterns.
- Packaging and publishing are separate from source authoring. Packaged output is for distribution, not for replacing your working source tree.

## LLM helper implications

- The helper should understand `.gproj`, `.c`, `.conf`, `.st`, and other text-centric files first.
- Read-only inspection should come before editing.
- The model should not get unrestricted filesystem access. It should only see configured mod, docs, and sample roots.
- Web access is still useful because Bohemia docs, community examples, and tool guidance evolve.
- A good first architecture is a local MCP server plus a client that uses OpenAI tools for reasoning, retrieval, and web research.

## Recommended architecture

### Local layer

- A `reforger-mcp` server exposing:
  - config-aware file listing
  - text search
  - safe file reads
  - mod structure summary
  - later, guarded file writes
  - later, Workbench build/package commands

### LLM layer

- Use OpenAI Responses API for the main agent loop.
- Use OpenAI `file_search` for indexed docs and reference material.
- Use OpenAI `web_search` for current documentation or community lookups when needed.
- Keep local mod access behind MCP/function tools instead of pasting large file trees into prompts.

### Process layer

- One mod change per Git branch.
- Agent reads the target mod path, proposes a plan, edits text files, then reports exactly what changed.
- Human runs the local game/workbench test loop.
- If the change works, commit and tag it. If not, revert or refine the branch.

## Recommended first milestone

Start by modifying a small sample addon or your own tiny addon, not a third-party Workshop dependency. The goal of milestone one is to prove the loop:

1. Agent can inspect the mod files.
2. Agent can identify the right files to change.
3. Agent can make a small text change safely.
4. You can test that change in-game.

## Source links

- [Arma Reforger: Mod Project Setup](https://community.bohemia.net/wiki/Arma_Reforger%3AMod_Project_Setup?useskin=darkvector)
- [Arma Reforger: Directory Structure](https://community.bohemia.net/wiki/Arma_Reforger%3ADirectory_Structure?useskin=vector)
- [Arma Reforger: Scripting Example](https://community.bohemia.net/wiki/Arma_Reforger%3AScripting_Example)
- [Arma Reforger: Workbench Plugin](https://community.bohemia.net/wiki/Arma_Reforger%3AWorkbench_Plugin)
- [Arma Reforger: Workbench Plugin Tutorial](https://community.bohemia.net/wiki/Arma_Reforger%3AWorkbench_Plugin_Tutorial)
- [Arma Reforger: Startup Parameters](https://community.bohemia.net/wiki/Arma_Reforger%3AStartup_Parameters?useskin=vector)
- [Arma Reforger: Mod Publishing Process](https://community.bohemia.net/wiki/Arma_Reforger%3AMod_Publishing_Process?useskin=darkvector)
- [BohemiaInteractive/Arma-Reforger-Samples](https://github.com/BohemiaInteractive/Arma-Reforger-Samples)
- [OpenAI code generation guide](https://developers.openai.com/api/docs/guides/code-generation)
- [OpenAI file search guide](https://developers.openai.com/api/docs/guides/tools-file-search)
- [OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
