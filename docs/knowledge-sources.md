# Knowledge Sources

## Purpose

This helper uses three knowledge layers:

1. Offline API HTML docs from the local Tools install, with the existing cache as a fallback.
2. Curated official Bohemia wiki pages saved locally.
3. Local mod folders and the official samples repo.

## Local sources

`prepare-knowledge` looks for unpacked `classes.html` in these installed Tools directories:

- `Arma Reforger Tools/Workbench/docs/ArmaReforgerScriptAPIPublic/html`
- `Arma Reforger Tools/Workbench/docs/EnfusionScriptAPI/html`

It locates the Tools installation through Steam's `libraryfolders.vdf` and the configured `docRoots`. If the installed HTML is unavailable, it uses existing copies under `.cache/knowledge/offline-api`. It never modifies the Tools installation or requires API ZIP files.

The configured `modRoots` and `sampleRoots` supply local addon and sample sources. `reforger-agent.config.json` holds machine-specific paths and is excluded from Git.

## Curated official web sources

The `prepare-knowledge` command snapshots these pages into `.cache/knowledge/official-web`. Existing pages are reused; `prepare-knowledge --force` refreshes the web snapshots without rebuilding or deleting API docs.

- Mod Project Setup
- Directory Structure
- File Types
- Data Modding Basics
- Asset Browser Mod Integration
- Prefabs Basics
- Entity Catalog
- Scripting Example
- Workbench Plugin
- Workbench Plugin Tutorial
- Startup Parameters
- Mod Publishing Process
- Vehicle Creation
- Weapon Modding
- Weapon Creation/Asset Preparation
- Weapon Optic Creation
- Resource Manager: Batch Texture Processor Plugin

## Feature research

Follow the [research/reuse decision](workflows.md#research-and-reuse-before-implementation)
before implementation. Start with the [feature recipes](feature-recipes.md) and
the addon's existing records. `npm run knowledge:prepare` discovers installed
docs and reuses cached official pages; check snapshot age/version before relying
on them and use `--force` only when a refresh is useful. A failed web fetch does
not invalidate available installed docs or saved source evidence.

Use `npm run cli -- search-text '<query>' --rootType all --limit 20` for configured source roots and
`npm run pak:source -- --help` with the [selective reader](selective-pak-source.md)
for exact installed text resources. Inspect only needed paths; retain package and
resource identities in the addon record, without redistributing reference caches.
Start official examples at [Bohemia's samples](https://github.com/BohemiaInteractive/Arma-Reforger-Samples)
and pin a commit for the example actually used. Consult the mod author's public
Workshop/wiki/repository and relevant accessible community discussions too;
distinguish author documentation, observed working behavior and untested advice.
Record failed/unavailable lookups and the next useful source instead of stopping
at a single fetch failure. Check the actual source's license; the samples'
terms do not cover unrelated Workshop mods.

## Why this matters

- Offline API docs cover classes and engine behavior.
- Official wiki pages cover workflows, override mechanics, packaging, and asset pipelines.
- The samples repo provides concrete examples of valid project and prefab structure.
- Installed packed addons let the helper inspect real Workshop packages even when source assets are unavailable.
