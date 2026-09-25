import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface ModSelection {
  modId: string;
  name: string;
  required: true;
}

export interface LocalServerConfig {
  bindAddress: "127.0.0.1";
  bindPort: number;
  publicAddress: "127.0.0.1";
  publicPort: number;
  game: {
    name: string;
    scenarioId: string;
    maxPlayers: 2;
    visible: false;
    gameProperties: { fastValidation: true };
    mods: ModSelection[];
  };
}

const USAGE = `Local Reforger server config generator

  npm run server:config -- --scenario '{GUID}Missions/Scenario.conf' [--mod WORKSHOP_ID[=Name] ...] [--port 2001] [--out .cache/local-server/config.json] [--force]

Writes a private, loopback-bound config. This tool does not start a server or download mods.
`;

export function parseModSelection(value: string): ModSelection {
  const separator = value.indexOf("=");
  const id = (separator < 0 ? value : value.slice(0, separator)).trim().toUpperCase();
  const name = (separator < 0 ? id : value.slice(separator + 1)).trim();
  if (!/^[0-9A-F]{16}$/.test(id)) {
    throw new Error(`Invalid Workshop mod ID: ${id}. Expected 16 hexadecimal characters.`);
  }
  if (!name) {
    throw new Error(`Mod ${id} must have a nonempty name after =.`);
  }
  return { modId: id, name, required: true };
}

export function makeLocalServerConfig(scenarioId: string, modValues: string[], port: number): LocalServerConfig {
  if (!/^\{[0-9A-Fa-f]{16}\}.+\.conf$/.test(scenarioId)) {
    throw new Error("--scenario must be a complete {GUID}...conf scenario ID from -listScenarios.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port must be an integer from 1024 through 65535.");
  }
  const mods = modValues.map(parseModSelection);
  const ids = mods.map((mod) => mod.modId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate Workshop mod IDs are not allowed.");
  }

  return {
    bindAddress: "127.0.0.1",
    bindPort: port,
    publicAddress: "127.0.0.1",
    publicPort: port,
    game: {
      name: "Reforger local mod test",
      scenarioId,
      maxPlayers: 2,
      visible: false,
      gameProperties: { fastValidation: true },
      mods,
    },
  };
}

interface CliOptions {
  scenarioId: string;
  modValues: string[];
  port: number;
  out: string;
  force: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let scenarioId = "";
  let port = 2001;
  let out = path.resolve(".cache", "local-server", "config.json");
  let force = false;
  const modValues: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--force") {
      force = true;
      continue;
    }
    if (!["--scenario", "--mod", "--port", "--out"].includes(option)) {
      throw new Error(`Unknown option: ${option}\n\n${USAGE}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Expected a value after ${option}.`);
    }
    switch (option) {
      case "--scenario":
        if (scenarioId) throw new Error("--scenario may be specified once.");
        scenarioId = value;
        break;
      case "--mod":
        modValues.push(value);
        break;
      case "--port":
        port = Number(value);
        break;
      case "--out":
        out = path.resolve(value);
        break;
    }
  }
  if (!scenarioId) throw new Error(`Missing --scenario.\n\n${USAGE}`);
  return { scenarioId, modValues, port, out, force };
}

export async function runServerConfigCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  const options = parseArgs(argv);
  const config = makeLocalServerConfig(options.scenarioId, options.modValues, options.port);
  if (!options.force) {
    try {
      await readFile(options.out);
      throw new Error(`Config already exists: ${options.out}. Pass --force to replace it.`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote local server config: ${options.out}\n`);
  process.stdout.write(`Scenario: ${config.game.scenarioId}; mods: ${config.game.mods.length}; visible: false; bind: 127.0.0.1:${config.bindPort}\n`);
  process.stdout.write("Use the guarded local server launcher to start this config and verify its live listener.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runServerConfigCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
