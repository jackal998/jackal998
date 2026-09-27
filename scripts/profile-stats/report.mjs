// The private weekly report: every detail the stats hold, as Markdown for a
// GitHub issue (and a README next to the full receipts in the private report
// repository). Never published from the public profile repository.

import { formatNumber, formatShare } from './render.mjs';

const TYPE_NAMES = {
  commits: 'Commits',
  pullRequests: 'Pull requests opened',
  reviews: 'Pull requests reviewed',
  issues: 'Issues opened',
  repositories: 'Repositories created',
};

const SOURCE_NAMES = {
  'organisation private': 'Organisation repositories, private',
  'personal private': 'My repositories, private',
  'personal public': 'My repositories, public',
  'public, other owners': 'Other public repositories',
};

const FOCUS_NAMES = { work: 'At work', side: 'Side projects', openSource: 'Open source' };

const BLOCKS = '▁▂▃▄▅▆▇█';
export function sparkline(values) {
  const max = Math.max(0, ...values);
  return values.map((v) => (v > 0 && max > 0 ? BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((v / max) * (BLOCKS.length - 1) + 0.5))] : ' ')).join('');
}

const pad2 = (n) => String(n).padStart(2, '0');
const one = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

function change(last, previous) {
  if (!previous) return last ? 'new' : '-';
  const pct = Math.round(((last - previous) / previous) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

// Text columns left, number columns right: `align` has one letter per column.
const table = (head, rows, align = `l${'r'.repeat(head.length - 1)}`) => [
  `| ${head.join(' | ')} |`,
  `|${head.map((_, i) => (align[i] === 'r' ? ' ---: ' : ' --- ')).join('|')}|`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
].join('\n');

/**
 * Returns { title, markdown }. `images` adds the full receipts, for the
 * README that sits next to them; an issue body leaves them out.
 */
export function renderReport(stats, { images = false } = {}) {
  const { contributions: c, types, calendar: cal, stack: s, week, health } = stats;
  const date = stats.generatedAt.slice(0, 10);
  const out = [];
  const line = (text = '') => out.push(text);

  line(`Past 12 months up to ${date}, in ${s.timeZone}. Private: this report never leaves the private repository.`);
  if (images) {
    line();
    line('<img src="activity-light.svg" width="410" alt="Activity receipt"> <img src="stack-light.svg" width="410" alt="Stack receipt">');
  }

  line();
  line('## This week');
  line();
  const weekRow = (name, w, fmt = formatNumber) => [name, fmt(w.last), fmt(w.previous), change(w.last, w.previous), one(w.average)];
  line(table(['', 'Last 7 days', 'Previous 7 days', 'Change', 'Weekly average'], [
    weekRow('Contributions', week.contributions),
    weekRow('Commits read', week.commits),
    weekRow('Lines changed', week.lines),
  ]));

  line();
  line('## Contributions');
  line();
  line(table(['', 'Public', 'Private', 'Total'], [
    ["GitHub's count", formatNumber(c.public), formatNumber(c.private), formatNumber(c.total)],
  ]));
  if (types) {
    line();
    line('By type, counted from the repositories (GitHub only reports private contributions as one number):');
    line();
    line(table(['Type', 'Public', 'Private'], types.items.map((item) => [
      TYPE_NAMES[item.key],
      item.public === null ? '-' : formatNumber(item.public),
      item.private === null ? '-' : formatNumber(item.private),
    ])));
  }
  line();
  line(`Weekly contributions, ${cal.weeks[0]?.start ?? ''} to ${date}:`);
  line();
  line(`\`${sparkline(cal.weeks.map((w) => w.count))}\` peak ${formatNumber(Math.max(0, ...cal.weeks.map((w) => w.count)))}`);

  line();
  line('## Habits');
  line();
  line(`- Active days: ${formatNumber(cal.activeDays)} of ${formatNumber(cal.days)} (${formatShare(cal.days ? cal.activeDays / cal.days : 0)})`);
  line(`- Longest streak: ${formatNumber(cal.longestStreak)} days; current streak: ${formatNumber(cal.currentStreak)} days`);
  if (cal.busiestDay) line(`- Busiest day: ${cal.busiestDay.date}, ${formatNumber(cal.busiestDay.count)} contributions`);
  if (cal.busiestWeekday) line(`- Busiest weekday: ${cal.busiestWeekday[0]}${cal.busiestWeekday.slice(1).toLowerCase()}`);
  if (s.peakHour !== null) {
    line(`- Commit hours: \`${sparkline(s.hours)}\` (00 to 23), peak ${pad2(s.peakHour)}:00-${pad2((s.peakHour + 1) % 24)}:00`);
  }

  line();
  line('## Stack');
  line();
  const rows = s.other ? [...s.items, s.other] : s.items;
  line(table(['Language', 'Lines', 'Share'], rows.map((row) => [row.name, formatNumber(row.lines), formatShare(row.share)])));
  line();
  line(`${formatNumber(s.lines)} lines changed (+${formatNumber(s.added)} / -${formatNumber(s.removed)}) in ${formatNumber(s.commits)} commits ` +
    `across ${formatNumber(s.repos)} repositories (${formatNumber(s.privateRepos)} private), ` +
    `${formatNumber(s.commits ? Math.round(s.lines / s.commits) : 0)} lines per commit.`);
  if (s.sources.length) {
    line();
    line('By kind of repository:');
    line();
    line(table(['Kind', 'Commits', 'Lines', 'Share', 'Main language'], s.sources.map((source) => [
      SOURCE_NAMES[source.key],
      formatNumber(source.commits),
      formatNumber(source.lines),
      formatShare(source.share),
      source.main ? `${source.main.name} ${formatShare(source.main.share)}` : '-',
    ]), 'lrrrl'));
  }
  if (s.focus.length) {
    line();
    line(`Main languages: ${s.focus.map((group) => `${FOCUS_NAMES[group.key].toLowerCase()} ` +
      group.languages.map((l) => `${l.name} ${formatShare(l.share)}`).join(', ')).join('; ')}.`);
  }

  line();
  line('## Health');
  line();
  if (health.readTokenScopes !== undefined) {
    line(`- READ_TOKEN scopes: ${health.readTokenScopes === null ? 'not a classic token' : health.readTokenScopes || 'none'}`);
  } else {
    line('- READ_TOKEN: not set, so private repositories are left out');
  }
  for (const source of health.sources) {
    line(`- Source "${source.label}": ${formatNumber(source.repos)} repositories read (${formatNumber(source.privateRepos)} private), ` +
      `${formatNumber(source.commits)} commits` +
      `${source.skipped ? `; ${formatNumber(source.skipped)} unreadable${source.ssoBlocked ? ` (${formatNumber(source.ssoBlocked)} need SSO authorisation)` : ''}` : ''}`);
  }
  if (health.capped) line('- Commit reading hit its cap: only the most recent commits were read.');
  if (health.searchIncomplete) line('- GitHub search returned incomplete results; the type counts may be low.');

  return { title: `Weekly report ${date}`, markdown: `${out.join('\n')}\n` };
}
