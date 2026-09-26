// Regenerates the profile README cards in profile/.
//
//   GITHUB_TOKEN=... node scripts/profile-stats/main.mjs --login jackal998
//   node scripts/profile-stats/main.mjs --fixture scripts/profile-stats/fixture.json --out /tmp/cards
//
// Every card is rendered before any file is written, so a failed API call or
// a sanity check leaves the previous cards untouched instead of breaking them.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildStats } from './aggregate.mjs';
import { fetchRaw } from './fetch.mjs';
import { formatNumber, formatShare, renderContributionsCard, renderLanguagesCard } from './render.mjs';

const { values: args } = parseArgs({
  options: {
    login: { type: 'string', default: process.env.PROFILE_LOGIN },
    fixture: { type: 'string' },
    out: { type: 'string', default: 'profile' },
  },
});

async function loadRaw() {
  if (args.fixture) return JSON.parse(await readFile(args.fixture, 'utf8'));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  if (!args.login) throw new Error('Pass --login or set PROFILE_LOGIN');
  return fetchRaw({ token, login: args.login });
}

function logSummary(raw, stats) {
  const c = stats.contributions;
  console.log(`Contributions: ${formatNumber(c.total)} total, ${formatNumber(c.public)} public, ${formatNumber(c.private)} private`);
  console.log(`Past year: ${formatNumber(c.pastYear.total)} (${formatNumber(c.pastYear.private)} private)`);
  for (const y of raw.years) {
    const typed = y.commits + y.issues + y.pullRequests + y.reviews + y.repositories;
    console.log(`  ${y.year}: calendar ${y.calendarTotal}, private ${y.restricted}, public by type ${typed}`);
  }
  if (c.private === 0) {
    console.log('Note: no private contributions reported. Enable "Private contributions" in the profile\'s contribution settings to include them.');
  }
  console.log(`Languages across ${raw.repos.length} public repositories:`);
  for (const item of [...stats.languages.items, ...(stats.languages.other ? [stats.languages.other] : [])]) {
    console.log(`  ${item.name}: ${formatShare(item.share)} (${formatNumber(item.size)} bytes)`);
  }
}

const raw = await loadRaw();
const stats = buildStats(raw);
logSummary(raw, stats);

const files = {};
for (const theme of ['light', 'dark']) {
  files[`contributions-${theme}.svg`] = renderContributionsCard(stats, theme);
  files[`languages-${theme}.svg`] = renderLanguagesCard(stats, theme);
}

await mkdir(args.out, { recursive: true });
for (const [name, svg] of Object.entries(files)) {
  await writeFile(path.join(args.out, name), svg);
}
console.log(`Wrote ${Object.keys(files).length} cards to ${args.out}/`);
