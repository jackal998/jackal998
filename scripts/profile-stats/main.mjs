// Prints the profile README (header and receipts) or the private weekly report.
//
//   GITHUB_TOKEN=... node scripts/profile-stats/main.mjs --login jackal998            # public view, into profile/
//   GITHUB_TOKEN=... node scripts/profile-stats/main.mjs --view report --out report/  # private report
//   node scripts/profile-stats/main.mjs --fixture scripts/profile-stats/test/fixture.json --out /tmp/receipt
//
// An optional READ_TOKEN (a classic token with the `repo` scope, authorised
// for the employer's SSO) adds private repositories - personal and company.
// The code only ever reads with it.
//
// Both views read the same data; views.mjs decides what the public one shows.
// The public view runs in the public profile repository, whose logs are public
// too, so it only logs what its receipts print. The report view prints every
// detail and must only run where its output and logs stay private.
//
// Everything is rendered and checked before any file is written, so a failed
// API call, a sanity check or the leak guard leaves the previous output in
// place instead of breaking or exposing anything.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildStats } from './aggregate.mjs';
import { fetchActivity, fetchStack, fetchTypes, tokenScopes } from './fetch.mjs';
import { assertNoLeak } from './guard.mjs';
import { formatNumber, formatShare, renderHeader, renderReceipts } from './render.mjs';
import { renderReport } from './report.mjs';
import { publicView } from './views.mjs';

const PROFILE = {
  name: 'E.J. Lin',
  role: 'Back End Developer',
  footnote: 'Private includes company work',
  timeZone: 'Asia/Taipei', // commit hours and report dates use this zone
};

const { values: args } = parseArgs({
  options: {
    login: { type: 'string', default: process.env.PROFILE_LOGIN },
    view: { type: 'string', default: 'public' },
    fixture: { type: 'string' },
    out: { type: 'string', default: 'profile' },
  },
});
if (!['public', 'report'].includes(args.view)) throw new Error(`Unknown --view "${args.view}": use public or report`);
const report = args.view === 'report';

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
  const activity = await fetchActivity({ token: process.env.GITHUB_TOKEN, login: args.login });
  const stack = await fetchStack({ sources: stackSources(), login: args.login, now, timeZone: PROFILE.timeZone });
  // Only the report shows contributions by type, so only it spends the searches.
  // GitHub reports private contributions as one number; the read token counts
  // them from the repositories instead.
  const types = report ? await fetchTypes({
    source: process.env.READ_TOKEN
      ? { token: process.env.READ_TOKEN, sensitive: true }
      : { token: process.env.GITHUB_TOKEN, sensitive: false },
    login: args.login,
    now,
    includePrivate: Boolean(process.env.READ_TOKEN),
  }) : undefined;
  const readTokenScopes = process.env.READ_TOKEN ? await tokenScopes(process.env.READ_TOKEN) : undefined;
  return { profile: PROFILE, login: args.login, generatedAt: now.toISOString(), activity, types, stack, readTokenScopes };
}

// The public log: what the public receipts print, plus warnings that need no
// detail. Actions logs of the public repository are public.
function publicSummary(view, stats) {
  const lines = [];
  const c = view.contributions;
  lines.push(`Contributions, past 12 months: ${formatNumber(c.total)} total, ${formatNumber(c.public)} public, ${formatNumber(c.private)} private`);
  if (c.private === 0) {
    lines.push('Note: no private contributions reported. Enable "Private contributions" in the profile\'s contribution settings to include them.');
  }
  const s = view.stack;
  lines.push(`Languages: ${[...s.items, ...(s.other ? [s.other] : [])].map((i) => `${i.name} ${formatShare(i.share)}`).join(', ') || 'none'}`);
  lines.push(`Main languages: ${s.focus.map((group) => `${group.key} ${group.languages.join(' + ')}`).join(', ') || 'none'}`);
  const health = stats.health;
  if (health.readTokenScopes !== undefined) {
    lines.push(s.includesPrivate
      ? 'READ_TOKEN: private repositories included'
      : 'READ_TOKEN read no private repositories: it needs the `repo` scope, and SSO authorisation for organisation repositories.');
    const skipped = health.sources.reduce((acc, source) => acc + source.skipped, 0);
    const sso = health.sources.reduce((acc, source) => acc + source.ssoBlocked, 0);
    if (sso) lines.push(`Warning: ${sso} repositories need SSO authorisation for READ_TOKEN.`);
    else if (skipped) lines.push(`Note: ${skipped} repositories could not be read.`);
  }
  if (health.capped) lines.push('Note: commit reading hit its cap; only the most recent commits were read.');
  return lines;
}

const raw = await loadRaw();
const stats = buildStats(raw);
const secretNames = raw.stack.secretNames ?? [];
const files = {};
let summary;

if (report) {
  // Full detail: the receipts as they print from the full stats, and the report.
  for (const theme of ['light', 'dark']) {
    const receipts = renderReceipts(stats, theme);
    files[`activity-${theme}.svg`] = receipts.activity;
    files[`stack-${theme}.svg`] = receipts.stack;
  }
  const { title, markdown } = renderReport(stats);
  files['README.md'] = `# ${title}\n\n${renderReport(stats, { images: true }).markdown}`;
  files['issue.md'] = markdown;
  files['title.txt'] = `${title}\n`;
  summary = markdown;
} else {
  const view = publicView(stats);
  for (const theme of ['light', 'dark']) {
    const receipts = renderReceipts(view, theme);
    files[`header-${theme}.svg`] = renderHeader(view, theme);
    files[`activity-${theme}.svg`] = receipts.activity;
    files[`stack-${theme}.svg`] = receipts.stack;
  }
  summary = publicSummary(view, stats).join('\n');
}

// Even the private report never names a private repository or organisation.
assertNoLeak('the log summary', summary, secretNames);
for (const [name, text] of Object.entries(files)) assertNoLeak(name, text, secretNames);
console.log(summary);

await mkdir(args.out, { recursive: true });
for (const [name, text] of Object.entries(files)) {
  await writeFile(path.join(args.out, name), text);
}
console.log(`Wrote ${Object.keys(files).length} files to ${args.out}/`);
