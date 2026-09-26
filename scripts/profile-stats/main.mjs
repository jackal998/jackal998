// Regenerates the profile README receipt in profile/.
//
//   GITHUB_TOKEN=... node scripts/profile-stats/main.mjs --login jackal998
//   node scripts/profile-stats/main.mjs --fixture scripts/profile-stats/test/fixture.json --out /tmp/receipt
//
// Optional read-only tokens add private repositories to the language
// breakdown: READ_TOKEN_WORK (a fine-grained token for the employer's
// organization) and READ_TOKEN_PERSONAL (one for the user's own account).
//
// Both themes are rendered before any file is written, so a failed API call or
// sanity check leaves the previous receipt untouched instead of breaking it.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildStats } from './aggregate.mjs';
import { fetchActivity, fetchStack } from './fetch.mjs';
import { formatNumber, formatShare, renderReceipt } from './render.mjs';

const PROFILE = { name: 'E.J. Lin', role: 'Back End Developer' };

const { values: args } = parseArgs({
  options: {
    login: { type: 'string', default: process.env.PROFILE_LOGIN },
    fixture: { type: 'string' },
    out: { type: 'string', default: 'profile' },
  },
});

// Most capable first: a repository is read with the first token that sees it.
// GITHUB_TOKEN is limited to 1,000 requests an hour, so it reads fewer commits.
function stackSources() {
  const sources = [];
  if (process.env.READ_TOKEN_WORK) {
    sources.push({ label: 'work', token: process.env.READ_TOKEN_WORK, listAll: true, sensitive: true, maxCommits: 3000 });
  }
  if (process.env.READ_TOKEN_PERSONAL) {
    sources.push({ label: 'personal', token: process.env.READ_TOKEN_PERSONAL, listAll: true, sensitive: true, maxCommits: 3000 });
  }
  sources.push({ label: 'default', token: process.env.GITHUB_TOKEN, listAll: false, sensitive: false, maxCommits: 700 });
  return sources;
}

async function loadRaw() {
  if (args.fixture) return JSON.parse(await readFile(args.fixture, 'utf8'));
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set');
  if (!args.login) throw new Error('Pass --login or set PROFILE_LOGIN');
  const now = new Date();
  const activity = await fetchActivity({ token: process.env.GITHUB_TOKEN, login: args.login, now });
  const stack = await fetchStack({ sources: stackSources(), login: args.login, now });
  return { profile: PROFILE, login: args.login, generatedAt: now.toISOString(), activity, stack };
}

// Aggregates only: Actions logs of a public repository are public.
function logSummary(raw, stats) {
  const c = stats.contributions;
  console.log(`Contributions: ${formatNumber(c.total)} total, ${formatNumber(c.public)} public, ${formatNumber(c.private)} private`);
  console.log(`Past 12 months: ${formatNumber(c.pastYear.total)} (${formatNumber(c.pastYear.private)} private)`);
  if (c.private === 0) {
    console.log('Note: no private contributions reported. Enable "Private contributions" in the profile\'s contribution settings to include them.');
  }
  for (const s of raw.stack.log ?? []) {
    console.log(`Stack source "${s.label}": ${s.repos} repositories (${s.privateRepos} private), ${s.commits} commits read`);
  }
  const s = stats.stack;
  console.log(`Stack: ${formatNumber(s.commits)} commits, ${formatNumber(s.lines)} lines changed${s.capped ? ' (capped to the most recent commits)' : ''}`);
  for (const item of [...s.items, ...(s.other ? [s.other] : [])]) {
    console.log(`  ${item.name}: ${formatShare(item.share)} (${formatNumber(item.lines)} lines)`);
  }
}

const raw = await loadRaw();
const stats = buildStats(raw);
logSummary(raw, stats);

const files = {
  'receipt-light.svg': renderReceipt(stats, 'light'),
  'receipt-dark.svg': renderReceipt(stats, 'dark'),
};

await mkdir(args.out, { recursive: true });
for (const [name, svg] of Object.entries(files)) {
  await writeFile(path.join(args.out, name), svg);
}
console.log(`Wrote ${Object.keys(files).length} files to ${args.out}/`);
