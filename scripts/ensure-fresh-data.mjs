import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const marketPath = path.resolve(process.cwd(), 'public', 'data', 'market-hubs.json');

async function getSnapshotAgeMs() {
  try {
    const raw = await fs.readFile(marketPath, 'utf8');
    // Fast check for "updatedAt":"..." near the start of the JSON
    const match = raw.slice(0, 512).match(/"updatedAt"\s*:\s*"([^"]+)"/);
    if (match) {
      const ts = new Date(match[1]).getTime();
      if (Number.isFinite(ts)) return Date.now() - ts;
    }
    const stat = await fs.stat(marketPath);
    return Date.now() - stat.mtimeMs;
  } catch {
    return Infinity;
  }
}

const ageMs = await getSnapshotAgeMs();
if (ageMs <= MAX_AGE_MS) {
  const mins = Math.max(0, Math.round(ageMs / 60000));
  console.log(`[ensure-fresh-data] Market snapshot is fresh (${mins}m ago). Starting Vite...`);
  process.exit(0);
}

const hours = Number.isFinite(ageMs) ? `${(ageMs / 3600000).toFixed(1)}h` : 'missing';
console.log(`[ensure-fresh-data] Market snapshot is stale (${hours}). Refreshing data...`);

const res = spawnSync(process.execPath, [path.resolve(process.cwd(), 'scripts', 'fetch-market.mjs')], {
  stdio: 'inherit',
});
if (res.status !== 0) {
  console.warn('[ensure-fresh-data] fetch-market failed; continuing with existing snapshot.');
}
process.exit(0);
