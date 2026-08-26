import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_ID_RE = /(?:tiktok\.com\/@[^/]+\/video\/|tiktok\.com\/(?:t\/)?video\/|\/video\/)(\d{15,})/;
const BARE_ID_RE = /^\d{15,}$/;

export function extractVideoId(input) {
  const trimmed = input.trim();
  if (BARE_ID_RE.test(trimmed)) return trimmed;
  const match = trimmed.match(VIDEO_ID_RE) ?? trimmed.match(/tiktok\.com\/.*\/video\/(\d+)/);
  return match?.[1] ?? null;
}

function lineKey(line) {
  const id = extractVideoId(line);
  if (id) return `id:${id}`;
  return `line:${line.trim().toLowerCase()}`;
}

export async function dedupeVideosFile(filePath) {
  const original = await readFile(filePath, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);

  const kept = [];
  const seen = new Set();
  let removed = 0;
  let previousBlank = false;

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (!trimmed) {
      if (kept.length === 0 || previousBlank) continue;
      kept.push('');
      previousBlank = true;
      continue;
    }

    if (trimmed.startsWith('#')) {
      kept.push(raw.trimEnd());
      previousBlank = false;
      continue;
    }

    const key = lineKey(trimmed);
    if (seen.has(key)) {
      removed += 1;
      continue;
    }

    seen.add(key);
    kept.push(trimmed);
    previousBlank = false;
  }

  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();

  const next = `${kept.join(newline)}${newline}`;
  if (next !== original) {
    await writeFile(filePath, next);
  }

  return { kept: kept.filter((line) => line && !line.startsWith('#')).length, removed };
}

const isDirectRun = String(process.argv[1] ?? '').replaceAll('\\', '/').endsWith('scripts/dedupe-videos.mjs');

if (isDirectRun) {
  const filePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'videos.txt');
  const result = await dedupeVideosFile(filePath);
  console.log(`Catalog has ${result.kept} unique videos. Removed ${result.removed} duplicates.`);
}
