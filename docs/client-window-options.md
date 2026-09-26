# Optional client window placement and unfocused updates

`client:run` accepts these optional flags. With none supplied, its launch arguments remain unchanged: a 1280 × 720 window, 60 FPS cap and the existing bounded duration or `--keep-open` behavior.

| Helper option | Client argument | Meaning |
|---|---|---|
| `--window-x <integer>` | `-posX <integer>` | Initial horizontal window position |
| `--window-y <integer>` | `-posY <integer>` | Initial vertical window position |
| `--force-update` | `-forceUpdate` | Request rendering and updates while the window lacks focus |

Bohemia documents initial position with `-window`, which this helper already supplies, and documents `-forceUpdate` for unfocused rendering and updates. See the official [Arma Reforger startup parameters](https://community.bistudio.com/wiki/Arma_Reforger:Startup_Parameters#Window).

Either coordinate can be supplied independently. Values must be signed decimal integers within JavaScript's safe-integer range (`-9007199254740991` through `9007199254740991`); zero and negative coordinates are accepted. This validation does not establish that a position is visible on the current monitor layout. Repeated flags, fractional/non-finite values and ambiguous numeric forms such as hexadecimal or exponent notation are rejected.

For example, preview a position lower on a suitable display:

```powershell
npm run client:run -- --profile .cache/client/profiles/window-test --world worlds/GameMaster/GM_Arland.ent --window-x 0 --window-y 320 --force-update --duration-seconds 300 --expect-game
```

This is a dry run. Inspect the printed command before adding `--execute`; choose coordinates that leave the game and any input tool visible. The executable working directory, isolated profile/log handling, addon-package guards and existing timer remain in effect.

**Validation status:** argument parsing and launch-plan tests cover these flags; their behavior has not yet been verified in a live client on this machine. Reduced game-clock progress while another window had focus motivated the option. `--force-update` is a request, not proof of equal wall-clock and simulation time: continue to record both when timing matters. The launcher's duration is wall time, and `--expect-game` confirms startup only.
