import { spawn } from "node:child_process";
import { lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireStorageSpace } from "./storage-preflight.js";

const USAGE = `Record a named window or a selected monitor with ffmpeg (dry run by default)

  npm run screen:record -- --backend gdigrab --window-title "<exact window title>" --duration-seconds 60 --output .cache/test-videos/scene.mp4 [--fps 30] --execute
  npm run screen:record -- --backend ddagrab --output-idx 1 --duration-seconds 60 --output .cache/test-videos/scene.mp4 [--fps 8] --execute

gdigrab captures only the named window but has produced a stale frame with Workbench gameplay on this machine. ddagrab uses Desktop Duplication and captures the entire selected monitor. Confirm the monitor index and keep other windows off it. The helper refuses to overwrite an existing file.
Execution requires at least 2 GiB free on the output filesystem; this preflight does not reserve space for the full recording.
`;

export interface RecordOptions {
  backend: "gdigrab" | "ddagrab";
  windowTitle?: string;
  outputIndex?: number;
  durationSeconds: number;
  fps: number;
  output: string;
  ffmpeg: string;
  execute: boolean;
}

export function parseRecordArgs(args: string[]): RecordOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--execute") {
      if (execute) throw new Error("--execute was provided twice.");
      execute = true;
      continue;
    }
    if (!["--backend", "--window-title", "--output-idx", "--duration-seconds", "--output", "--fps", "--ffmpeg"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    }
    const value = args[++i];
    if (!value || value.startsWith("--") || values.has(flag)) throw new Error(`Expected one value after ${flag}.`);
    values.set(flag, value);
  }
  const backend = values.get("--backend") ?? "gdigrab";
  if (backend !== "gdigrab" && backend !== "ddagrab") throw new Error("--backend must be gdigrab or ddagrab.");
  const windowTitle = values.get("--window-title")?.trim();
  const outputIndexText = values.get("--output-idx");
  const outputIndex = outputIndexText === undefined ? undefined : Number(outputIndexText);
  const output = values.get("--output");
  if (!output) throw new Error("--output is required.");
  if (backend === "gdigrab" && (!windowTitle || outputIndex !== undefined)) {
    throw new Error("gdigrab requires --window-title and does not accept --output-idx.");
  }
  if (backend === "ddagrab" && (windowTitle || outputIndex === undefined || !Number.isInteger(outputIndex) || outputIndex < 0)) {
    throw new Error("ddagrab requires a nonnegative --output-idx and captures the entire monitor; omit --window-title.");
  }
  const durationSeconds = Number(values.get("--duration-seconds") ?? "60");
  const fps = Number(values.get("--fps") ?? "30");
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 7200) {
    throw new Error("--duration-seconds must be an integer from 1 through 7200.");
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error("--fps must be an integer from 1 through 120.");
  if (windowTitle?.includes("\n") || windowTitle?.includes("\r")) throw new Error("Window title must be one line.");
  const resolvedOutput = path.resolve(output);
  if (path.extname(resolvedOutput).toLowerCase() !== ".mp4") throw new Error("--output must end in .mp4.");
  return { backend, windowTitle, outputIndex, durationSeconds, fps, output: resolvedOutput, ffmpeg: values.get("--ffmpeg") ?? "ffmpeg", execute };
}

export function recordCommand(options: RecordOptions): string[] {
  if (options.backend === "ddagrab") {
    return [
      "-hide_banner", "-n", "-f", "lavfi", "-i", `ddagrab=output_idx=${options.outputIndex}:framerate=${options.fps}`,
      "-vf", "hwdownload,format=bgra,format=yuv420p", "-t", String(options.durationSeconds),
      "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
      "-pix_fmt", "yuv420p", options.output,
    ];
  }
  return [
    "-hide_banner", "-n", "-f", "gdigrab", "-framerate", String(options.fps),
    "-i", `title=${options.windowTitle}`, "-t", String(options.durationSeconds),
    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
    "-pix_fmt", "yuv420p", options.output,
  ];
}

export async function runRecordCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseRecordArgs(argv);
  try {
    lstatSync(options.output);
    throw new Error(`Refusing to overwrite existing recording or output link: ${options.output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const command = recordCommand(options);
  process.stdout.write(`${options.ffmpeg} ${command.map((arg) => JSON.stringify(arg)).join(" ")}\n`);
  if (!options.execute) return 0;
  await requireStorageSpace([path.dirname(options.output)]);
  mkdirSync(path.dirname(options.output), { recursive: true });
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(options.ffmpeg, command, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runRecordCli().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
