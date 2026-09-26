import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const USAGE = `Capture a live log when a literal marker is first observed

  npm run logs:snapshot -- --log <console.log> --marker "RESULT:" --output <snapshot.log>
    [--timeout-seconds 600] [--poll-ms 250]

Writes the entire successful read, plus <snapshot.log>.provenance.json. Existing
evidence is never overwritten. This is a first-observed capture, not an exact
terminal prefix or an atomic view of a file being appended to. Source is read-only.
Timeout: 0.01–3600 seconds; poll: 10–5000 ms; maximum observed log: 64 MiB.
`;

export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export interface LogSnapshotOptions {
  logPath: string;
  marker: string;
  outputPath: string;
  timeoutMs: number;
  pollMs: number;
}

export interface LogSnapshotProvenance {
  method: "first observed marker; up to poll latency";
  startedUtc: string;
  readStartedUtc: string;
  capturedUtc: string;
  markerLiteral: string;
  firstMarkerOffsetBytes: number;
  pollMs: number;
  timeoutMs: number;
  attempts: number;
  source: { path: string; bytes: number; sha256: string; hashScope: "bytes in the captured read, not the later live file" };
  output: { path: string; bytes: number; sha256: string };
  provenancePath: string;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function validate(options: LogSnapshotOptions): LogSnapshotOptions {
  if (!options.logPath || !options.outputPath) throw new Error("Pass --log and --output paths.");
  if (!options.marker || options.marker.includes("\0")) throw new Error("Pass a nonempty literal --marker without NUL.");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 10 || options.timeoutMs > 3_600_000)
    throw new Error("--timeout-seconds must be between 0.01 and 3600.");
  if (!Number.isInteger(options.pollMs) || options.pollMs < 10 || options.pollMs > 5000)
    throw new Error("--poll-ms must be an integer between 10 and 5000.");
  const normalized = { ...options, logPath: path.resolve(options.logPath), outputPath: path.resolve(options.outputPath) };
  if (samePath(normalized.logPath, normalized.outputPath) || samePath(normalized.logPath, `${normalized.outputPath}.provenance.json`))
    throw new Error("The source log must differ from both evidence output paths.");
  return normalized;
}

export function parseLogSnapshotArgs(argv: string[]): LogSnapshotOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!["--log", "--marker", "--output", "--timeout-seconds", "--poll-ms"].includes(flag))
      throw new Error(`Unknown option: ${flag}\n\n${USAGE}`);
    if (values.has(flag)) throw new Error(`${flag} was provided twice.`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`Expected a value after ${flag}.`);
    values.set(flag, value);
  }
  return validate({
    logPath: values.get("--log") ?? "", marker: values.get("--marker") ?? "",
    outputPath: values.get("--output") ?? "",
    timeoutMs: Number(values.get("--timeout-seconds") ?? "600") * 1000,
    pollMs: Number(values.get("--poll-ms") ?? "250"),
  });
}

async function requireMissing(file: string): Promise<void> {
  try { await lstat(file); }
  catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
  throw new Error(`Refusing to overwrite existing evidence: ${file}`);
}

async function persist(bytes: Buffer, provenance: LogSnapshotProvenance): Promise<void> {
  await mkdir(path.dirname(provenance.output.path), { recursive: true });
  // Exclusive creation also protects against another watcher winning after
  // preflight. Reserve both paths before writing either evidence artifact.
  const sidecar = await open(provenance.provenancePath, "wx");
  let snapshot;
  try { snapshot = await open(provenance.output.path, "wx"); }
  catch (error) {
    await sidecar.close();
    await unlink(provenance.provenancePath); // only our own still-empty reservation
    throw error;
  }
  try {
    await snapshot.writeFile(bytes);
    await snapshot.sync();
    await sidecar.writeFile(`${JSON.stringify(provenance, null, 2)}\n`, "utf8");
    await sidecar.sync();
  } finally {
    // A write failure leaves its partial evidence visible, never silently
    // overwrites it on retry. Use a fresh output path after inspecting it.
    await Promise.all([snapshot.close(), sidecar.close()]);
  }
}

export async function captureLogSnapshot(input: LogSnapshotOptions): Promise<LogSnapshotProvenance> {
  const options = validate(input);
  const provenancePath = `${options.outputPath}.provenance.json`;
  await Promise.all([requireMissing(options.outputPath), requireMissing(provenancePath)]);
  const startedUtc = new Date().toISOString();
  const deadline = performance.now() + options.timeoutMs;
  const marker = Buffer.from(options.marker, "utf8");
  let attempts = 0;
  let lastReadError: string | undefined;
  while (performance.now() < deadline) {
    const readStartedUtc = new Date().toISOString();
    attempts++;
    let bytes: Buffer | undefined;
    try {
      const info = await stat(options.logPath);
      if (!info.isFile()) throw new Error(`Source log is not a regular file: ${options.logPath}`);
      if (info.size > MAX_SNAPSHOT_BYTES) throw new Error("Source log exceeds the 64 MiB snapshot limit.");
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) break;
      // Node's normal read sharing works with an open Windows append writer.
      // Do not use an exclusive .NET File.Open read on the game's live log.
      bytes = await readFile(options.logPath, { signal: AbortSignal.timeout(remaining) });
      if (bytes.length > MAX_SNAPSHOT_BYTES) throw new Error("Source log exceeds the 64 MiB snapshot limit.");
      lastReadError = undefined;
    } catch (error) {
      const code = errorCode(error);
      if (code === "ABORT_ERR") break;
      if (!["ENOENT", "EBUSY", "EACCES", "EPERM"].includes(code ?? "")) throw error;
      lastReadError = code;
    }
    const capturedUtc = new Date().toISOString();
    const offset = bytes?.indexOf(marker) ?? -1;
    if (bytes && offset >= 0 && performance.now() <= deadline) {
      const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
      const provenance: LogSnapshotProvenance = {
        method: "first observed marker; up to poll latency", startedUtc, readStartedUtc, capturedUtc,
        markerLiteral: options.marker, firstMarkerOffsetBytes: offset,
        pollMs: options.pollMs, timeoutMs: options.timeoutMs, attempts,
        source: { path: options.logPath, bytes: bytes.length, sha256, hashScope: "bytes in the captured read, not the later live file" },
        output: { path: options.outputPath, bytes: bytes.length, sha256 }, provenancePath,
      };
      await persist(bytes, provenance);
      return provenance;
    }
    const remaining = deadline - performance.now();
    if (remaining > 0) await delay(Math.min(options.pollMs, remaining));
  }
  throw new Error(`Timed out after ${options.timeoutMs / 1000}s waiting for literal marker ${JSON.stringify(options.marker)} in ${options.logPath}${lastReadError ? ` (last read: ${lastReadError})` : ""}. No snapshot captured.`);
}

export async function runLogSnapshot(argv: string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === "--help") { process.stdout.write(USAGE); return 0; }
  const provenance = await captureLogSnapshot(parseLogSnapshotArgs(argv));
  process.stdout.write(`${JSON.stringify(provenance, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLogSnapshot(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
