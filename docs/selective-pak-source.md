# Selective installed package inspection

`pak:source` reads package indexes and seeks directly to one explicitly requested text resource. It never starts the game, rewrites a package, or extracts the complete archive. Installed game source remains local and must not be committed or redistributed with this harness.

## Commands

Run these from the harness repository so extracted files land under its ignored `.cache/` directory. Replace the example installation path as needed.

```powershell
npm run pak:source -- list --root 'D:/SteamLibrary/steamapps/common/Arma Reforger/addons/data' --filter 'MapMenu' --limit 20
npm run pak:source -- find --root 'D:/SteamLibrary/steamapps/common/Arma Reforger/addons/data' --resource 'scripts/Game/Map/SCR_MapMenuUI.c'
npm run pak:source -- read --pack 'D:/SteamLibrary/steamapps/common/Arma Reforger/addons/data/data007.pak' --resource 'scripts/Game/Map/SCR_MapMenuUI.c'
npm run pak:source -- extract --pack 'D:/SteamLibrary/steamapps/common/Arma Reforger/addons/data/data007.pak' --resource 'scripts/Game/Map/SCR_MapMenuUI.c'
```

- `list` matches a path substring, reports total matches, and limits printed rows. It does not read resource payloads.
- `find` matches the complete resource path, ignoring case and accepting either slash convention. A basename matches only a resource at the archive root. It reports every matching package and exits unsuccessfully if none match.
- `read` and `extract` require exactly one matching package. Use `find`, then an explicit `--pack` to resolve duplicates; the helper does not guess engine mount precedence.
- `read` writes source to stdout and JSON provenance to stderr. For clean shell redirection use `npx tsx src/pak-source-cli.ts read ...` directly, since npm itself prints a script banner.
- `extract` creates only the requested source under `.cache/pak-source/<package-index-identity>/<resource-path>` and prints its destination/provenance. Existing files, redirected cache directories, and unsafe Windows filenames are rejected. No sidecar source bundle is created.
- Repeat `--pack` or `--root` to search more than one package/addon directory. Discovery does not follow directory symlinks. A malformed or unsupported selected package fails the command; narrow the package selection explicitly to investigate the rest.

Provenance includes canonical package path, size, modification time, header bytes, index SHA-256, selected offset/stored/raw sizes, compression metadata, and the decoded source SHA-256 after a read. The index hash is **not** a whole-package hash. This helper makes no claim about which addon instance a running process mounted.

## Verified local format and limits

Verified September 26, 2026 on the installed Windows Arma Reforger **1.8.0.13**, Steam build **24903726**. This is observed-format tooling, not an official archive-format guarantee.

- All 14 installed `addons/data/*.pak` indexes parsed completely: `data.pak`, `data001` through `data010`, and `worlds` through `worlds002`.
- The observed envelope is `FORM`, a big-endian 32-bit length, `PAC1`, then exactly `HEAD`, `DATA`, and `FILE` chunks with big-endian chunk lengths. `HEAD` is 28 bytes and begins `03 00 01 00`. Unsupported envelopes, versions, extra chunks, or trailing bytes are rejected.
- The `FILE` payload is a recursive directory tree. Entries contain a one-byte type, one-byte UTF-8 name length, and name bytes. A directory (type 0) has a little-endian 32-bit child count. A file (type 1) has 24 metadata bytes: little-endian offset/stored/raw sizes at offsets 0/4/8, with the observed compression metadata at offset 16. Other metadata is not interpreted. The root is an unnamed directory.
- Only observed raw (`00 00 00 00`) and zlib (`00 00 01 06`) resources are decoded. The reader checks declared and actual output length and valid UTF-8 without binary control characters. It restricts reads to text resource extensions; textures, audio, and other binary assets cannot be extracted through this command.
- Bounds: 32 MiB per index, 4 MiB per requested stored/decoded text, 250,000 directory entries, depth 64, and 512 selected packages. Payload offsets must lie wholly within `DATA`; indexes must consume exactly their declared length. Traversal, malformed/truncated entries, case-insensitive duplicate paths, unsupported compression, and decompression overrun fail closed.
- Package identity is checked again before reading the selected payload and file metadata is checked afterward. Game files are opened with read-only access. Stop package updates while inspecting them; the checks do not provide an immutable filesystem snapshot.

Concrete verified read: installed `data007.pak` is 1,994,525,893 bytes. Its 1,931,975-byte `FILE` payload contains 34,202 files. `scripts/Game/Map/SCR_MapMenuUI.c` is at offset 1,490,440,443, with 565 stored bytes and 2,168 decoded bytes. Index SHA-256: `ebd2bb2b7e1561cd8f2d773155870e8d77c03b2112d4be8601639cc982183b3e`. The exact script read passed size/UTF-8 checks. These values describe this installed build only; rerun `find` after updates.

Focused tests use synthetic package data authored in the test file. They cover full paths and duplicate basenames, raw/zlib reads, traversal, truncation, count/depth/offset bounds, version/chunk rejection, decompression limits, unsupported/binary text, changed packages, cache containment, and overwrite refusal. No game source or assets are included in the tests.

```powershell
npx vitest run tests/pak-source.test.ts
npm run typecheck
```
