# First Mod Workflow

## Recommendation

Start by modifying an official sample or a tiny addon you create yourself. Do not begin by editing somebody else's Workshop mod unless you fully understand its license and structure.

## Learning sequence

1. Verify that Arma Reforger Tools launches and that Workbench opens correctly.
2. Clone the official samples repo somewhere outside this helper repo.
3. Add one sample path to `reforger-agent.config.json`.
4. Use the MCP server to inspect the sample before touching anything.
5. Pick a tiny change:
   - a string table change
   - a simple config tweak
   - a small script behavior change
6. Test in Workbench or in the local game.
7. Commit the working state before attempting the next change.

## What a good first change looks like

- It only touches one or two files.
- It is easy to observe in-game.
- It does not depend on advanced systems like custom assets, animations, or multiplayer persistence.

## Good first tasks

- Change a display name in a string table.
- Change a simple spawn or inventory setting in a config.
- Change a small scripted value or conditional behavior in a sample addon.

## Bad first tasks

- Rebuilding a large third-party mod.
- Merging multiple Workshop mods together.
- Any change that needs custom art assets on day one.
- Any task where you cannot explain what "success" looks like before editing.

## Definition of success

The first modding milestone is not "make a big mod." It is:

1. Open the project.
2. Find the correct file.
3. Make one intentional change.
4. Launch and test it.
5. Revert or commit cleanly.
