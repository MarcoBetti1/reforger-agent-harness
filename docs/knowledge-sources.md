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

## Why this matters

- Offline API docs cover classes and engine behavior.
- Official wiki pages cover workflows, override mechanics, packaging, and asset pipelines.
- The samples repo provides concrete examples of valid project and prefab structure.
- Installed packed addons let the helper inspect real Workshop packages even when source assets are unavailable.
