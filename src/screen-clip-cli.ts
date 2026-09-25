import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = `Crop a completed monitor recording to the Workbench gameplay viewport (dry run by default)

  npm run screen:clip -- --input .cache/test-videos/raw.mp4 --output .cache/test-videos/review.mp4 [--start-seconds 30] [--duration-seconds 45] --execute

The default crop is left=1000, top=120, width=2060, height=1060 on a 3440x1440 monitor.
Override it with --left, --top, --width, and --height if the Workbench window moved.
The result fits into 1920x1080 without stretching, retains any input audio, and never overwrites the source or an existing output.
`;

export interface ClipOptions {
  input: string;
  output: string;
  left: number;
  top: number;
  width: number;
  height: number;
  startSeconds?: number;
  durationSeconds?: number;
  ffmpeg: string;
  execute: boolean;
}

function parseInteger(value: string | undefined, name: string, fallback: number, minimum: number): number {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`);
  return result;
}

function parseSeconds(value: string | undefined, name: string, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > 7200) {
    throw new Error(`${name} must be between ${minimum} and 7200 seconds.`);
  }
  return result;
}

export function parseClipArgs(args: string[]): ClipOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--execute") {
      if (execute) throw new Error("--execute was provided twice.");
      execute = true;
      continue;
    }
    if (!["--input", "--output", "--left", "--top", "--width", "--height", "--start-seconds", "--duration-seconds", "--ffmpeg"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    }
    const value = args[++i];
    if (!value || value.startsWith("--") || values.has(flag)) throw new Error(`Expected one value after ${flag}.`);
    values.set(flag, value);
  }
  const inputValue = values.get("--input");
  const outputValue = values.get("--output");
  if (!inputValue || !outputValue) throw new Error(`--input and --output are required.\n\n${USAGE}`);
  const input = path.resolve(inputValue);
  const output = path.resolve(outputValue);
  if (input.toLowerCase() === output.toLowerCase()) throw new Error("The output must differ from the source recording.");
  if (!existsSync(input)) throw new Error(`Input recording not found: ${input}`);
  if (path.extname(output).toLowerCase() !== ".mp4") throw new Error("--output must end in .mp4.");
  const left = parseInteger(values.get("--left"), "--left", 1000, 0);
  const top = parseInteger(values.get("--top"), "--top", 120, 0);
  const width = parseInteger(values.get("--width"), "--width", 2060, 2);
  const height = parseInteger(values.get("--height"), "--height", 1060, 2);
  if (width % 2 || height % 2) throw new Error("Crop width and height must be even for MP4 output.");
  const startSeconds = parseSeconds(values.get("--start-seconds"), "--start-seconds", 0);
  const durationSeconds = parseSeconds(values.get("--duration-seconds"), "--duration-seconds", 0.1);
  return {
    input, output, left, top, width, height, startSeconds, durationSeconds,
    ffmpeg: values.get("--ffmpeg") ?? "ffmpeg", execute,
  };
}

export function clipCommand(options: ClipOptions): string[] {
  const command = ["-hide_banner", "-n"];
  if (options.startSeconds !== undefined) command.push("-ss", String(options.startSeconds));
  command.push("-i", options.input);
  if (options.durationSeconds !== undefined) command.push("-t", String(options.durationSeconds));
  command.push(
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", `crop=${options.width}:${options.height}:${options.left}:${options.top},scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", options.output,
  );
  return command;
}

export async function runClipCli(argv = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const options = parseClipArgs(argv);
  if (existsSync(options.output)) throw new Error(`Refusing to overwrite existing clip: ${options.output}`);
  const command = clipCommand(options);
  process.stdout.write(`${options.ffmpeg} ${command.map((arg) => JSON.stringify(arg)).join(" ")}\n`);
  if (!options.execute) return 0;
  mkdirSync(path.dirname(options.output), { recursive: true });
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(options.ffmpeg, command, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runClipCli().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
