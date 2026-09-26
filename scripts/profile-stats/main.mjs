// Regenerates the profile README receipt in profile/.
//
//   GITHUB_TOKEN=... node scripts/profile-stats/main.mjs --login jackal998
//   node scripts/profile-stats/main.mjs --fixture scripts/profile-stats/test/fixture.json --out /tmp/receipt
//
// An optional READ_TOKEN (a classic token with the `repo` scope, authorised
// for the employer's SSO) adds private repositories - personal and company -
// to the language breakdown. The code only ever reads with it.
//
// Everything is rendered and checked before any file is written, so a failed
// API call, a sanity check or the leak guard leaves the previous receipt in
// place instead of breaking or exposing anything.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildStats, rankLanguages } from './aggregate.mjs';
import { fetchActivity, fetchStack, tokenScopes } from './fetch.mjs';
import { assertNoLeak } from './guard.mjs';
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
  if (process.env.READ_TOKEN) {
    sources.push({ label: 'read token', token: process.env.READ_TOKEN, listAll: true, sensitive: true, maxCommits: 3000 });
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
  const readTokenScopes = process.env.READ_TOKEN ? await tokenScopes(process.env.READ_TOKEN) : undefined;
  return { profile: PROFILE, login: args.login, generatedAt: now.toISOString(), activity, stack, readTokenScopes };
}

// Aggregates only: Actions logs of a public repository are public.
function summaryLines(raw, stats) {
  const lines = [];
  const log = (line) => lines.push(line);
  const c = stats.contributions;
  log(`Contributions: ${formatNumber(c.total)} total, ${formatNumber(c.public)} public, ${formatNumber(c.private)} private`);
  log(`Past 12 months: ${formatNumber(c.pastYear.total)} (${formatNumber(c.pastYear.private)} private)`);
  if (c.private === 0) {
    log('Note: no private contributions reported. Enable "Private contributions" in the profile\'s contribution settings to include them.');
  }
  if (raw.readTokenScopes !== undefined) {
    log(`READ_TOKEN scopes: ${raw.readTokenScopes === null ? '(not a classic token)' : raw.readTokenScopes || '(none)'}`);
  }
  for (const s of raw.stack.log ?? []) {
    log(`Stack source "${s.label}": ${s.repos} repositories read (${s.privateRepos} private), ${s.commits} commits read` +
      (s.skipped ? `; ${s.skipped} skipped as unreadable${s.ssoBlocked ? ` (${s.ssoBlocked} need SSO authorisation)` : ''}` : ''));
  }
  if (raw.readTokenScopes !== undefined && !raw.stack.privateRepos) {
    log('READ_TOKEN read no private repositories: it needs the `repo` scope, and SSO authorisation for organisation repositories.');
  }
  const s = stats.stack;
  log(`Stack: ${formatNumber(s.commits)} commits, ${formatNumber(s.lines)} lines changed${s.capped ? ' (capped to the most recent commits)' : ''}`);
  for (const item of [...s.items, ...(s.other ? [s.other] : [])]) {
    log(`  ${item.name}: ${formatShare(item.share)} (${formatNumber(item.lines)} lines)`);
  }
  const top = (weights) => {
    const r = rankLanguages(weights, { top: 4 });
    return [...r.items, ...(r.other ? [r.other] : [])].map((i) => `${i.name} ${formatShare(i.share)}`).join(', ') || '-';
  };
  if (raw.stack.perCommit && Object.keys(raw.stack.perCommit).length) {
    log(`Same commits, each commit counted once: ${top(raw.stack.perCommit)}`);
  }
  if (raw.stack.categories) {
    log('Breakdown by where the commits were made:');
    for (const [name, c] of Object.entries(raw.stack.categories).sort((x, y) => y[1].commits - x[1].commits)) {
      log(`  ${name}: ${formatNumber(c.commits)} commits, ${formatNumber(c.lines)} lines`);
      log(`    by lines:   ${top(c.languages)}`);
      log(`    by commits: ${top(c.perCommit)}`);
    }
  }
  if (raw.stack.estimate && Object.keys(raw.stack.estimate).length) {
    const e = rankLanguages(raw.stack.estimate);
    log('For comparison, repository languages weighted by my commits (GitHub contribution data):');
    for (const item of [...e.items, ...(e.other ? [e.other] : [])]) log(`  ${item.name}: ${formatShare(item.share)}`);
  }
  return lines;
}

const raw = await loadRaw();
const stats = buildStats(raw);
const secretNames = raw.stack.secretNames ?? [];

const summary = summaryLines(raw, stats).join('\n');
assertNoLeak('the log summary', summary, secretNames);
console.log(summary);

const files = {
  'receipt-light.svg': renderReceipt(stats, 'light'),
  'receipt-dark.svg': renderReceipt(stats, 'dark'),
};
for (const [name, svg] of Object.entries(files)) assertNoLeak(name, svg, secretNames);

await mkdir(args.out, { recursive: true });
for (const [name, svg] of Object.entries(files)) {
  await writeFile(path.join(args.out, name), svg);
}
console.log(`Wrote ${Object.keys(files).length} files to ${args.out}/`);
