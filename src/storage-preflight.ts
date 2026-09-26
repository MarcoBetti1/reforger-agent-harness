import { lstat, realpath, stat, statfs } from "node:fs/promises";
import path from "node:path";

export const MINIMUM_FREE_STORAGE_BYTES = 2n * 1024n * 1024n * 1024n;

export interface StorageCheck {
  outputDirectory: string;
  existingAncestor: string;
  availableBytes: bigint;
}

async function existingDirectoryAncestor(outputDirectory: string): Promise<string> {
  let candidate = outputDirectory;
  while (true) {
    try {
      await lstat(candidate);
    } catch (error) {
      const parent = path.dirname(candidate);
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && parent !== candidate) {
        candidate = parent;
        continue;
      }
      throw error;
    }
    // Resolve junctions/symlinks before probing the volume. A dangling link or
    // inaccessible existing ancestor is an error, not permission to probe CWD.
    const resolved = await realpath(candidate);
    if (!(await stat(resolved)).isDirectory()) {
      throw new Error(`Existing output ancestor is not a directory: ${candidate}`);
    }
    return resolved;
  }
}

/** Read-only launch gate, not a reservation or a guarantee for an entire run. */
export async function requireStorageSpace(outputDirectories: readonly string[]): Promise<StorageCheck[]> {
  const checks: StorageCheck[] = [];
  for (const outputDirectory of new Set(outputDirectories.map((value) => path.resolve(value)))) {
    let check: StorageCheck;
    try {
      const existingAncestor = await existingDirectoryAncestor(outputDirectory);
      const filesystem = await statfs(existingAncestor, { bigint: true });
      if (filesystem.bsize <= 0n || filesystem.bavail < 0n) {
        throw new Error("Filesystem returned invalid available-space counters.");
      }
      check = { outputDirectory, existingAncestor, availableBytes: filesystem.bsize * filesystem.bavail };
    } catch (error) {
      throw new Error(`Cannot verify free storage for ${outputDirectory}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (check.availableBytes < MINIMUM_FREE_STORAGE_BYTES) {
      throw new Error(`Insufficient free storage for ${outputDirectory}: ${check.availableBytes} bytes available on ${check.existingAncestor}; at least ${MINIMUM_FREE_STORAGE_BYTES} bytes (2 GiB) required. Free space or select another output volume before executing.`);
    }
    checks.push(check);
  }
  return checks;
}
