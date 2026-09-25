import { readFile } from "node:fs/promises";

const ASSET_PATH_PATTERN =
  /(?:\{[0-9A-F]{16}\})?(?:[A-Za-z0-9 _.-]+\/)+[A-Za-z0-9 _.-]+\.[A-Za-z0-9_]+/g;

export async function listBinaryAssetPaths(filePath: string, limit = 400): Promise<string[]> {
  const buffer = await readFile(filePath);
  return extractAssetPathsFromBuffer(buffer, limit);
}

export async function searchBinaryContext(
  filePath: string,
  query: string,
  limit = 5,
  window = 800,
): Promise<string[]> {
  const buffer = await readFile(filePath);
  const needle = Buffer.from(query, "utf8");

  if (needle.length === 0) {
    return [];
  }

  const results: string[] = [];
  let offset = 0;

  while (offset < buffer.length && results.length < limit) {
    const index = buffer.indexOf(needle, offset);
    if (index < 0) {
      break;
    }

    const start = Math.max(0, index - window);
    const end = Math.min(buffer.length, index + needle.length + window);
    results.push(sanitizeBinaryWindow(buffer.subarray(start, end)));
    offset = index + needle.length;
  }

  return results;
}

export function extractAssetPathsFromBuffer(buffer: Buffer, limit = 400): string[] {
  const text = buffer.toString("latin1").replace(/[^\x20-\x7E]/g, "\n");
  const seen = new Set<string>();
  const matches = text.match(ASSET_PATH_PATTERN) ?? [];

  for (const match of matches) {
    seen.add(match);
    if (seen.size >= limit) {
      break;
    }
  }

  return [...seen];
}

function sanitizeBinaryWindow(buffer: Buffer): string {
  const text = buffer
    .toString("latin1")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ".")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
