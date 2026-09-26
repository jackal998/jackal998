import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildStats, rankLanguages, summarizeCalendar, summarizeContributions, summarizeSources, summarizeStack, summarizeTypes,
} from '../aggregate.mjs';
import { assertNoLeak, findLeaks } from '../guard.mjs';
import { languageOf, linesChanged, splitChanged } from '../languages.mjs';
import { escapeXml, formatShare, measure, renderHeader, renderReceipts } from '../render.mjs';

const raw = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));

test('past-year contributions split into public and private', () => {
  assert.deepEqual(summarizeContributions(raw.activity), { total: 1864, private: 1502, public: 362 });
});

test('refuses to publish when private exceeds the calendar total', () => {
  assert.throws(() => summarizeContributions({ calendarTotal: 3, restricted: 5 }),
    /past 12 months: private contributions \(5\) exceed the calendar total \(3\)/);
});

test('stack ranks languages by lines changed and folds the tail into Other', () => {
  const s = summarizeStack(raw.stack);
  assert.deepEqual(s.items.map((i) => i.name), ['Ruby', 'Python', 'TypeScript', 'HTML+ERB', 'JavaScript', 'SQL']);
  assert.equal(s.items[0].share, 0.63);
  assert.deepEqual({ ...s.other, share: +s.other.share.toFixed(3) }, { name: 'Other', lines: 5000, share: 0.025, count: 3 });
  assert.equal(s.includesPrivate, true);
  const total = [...s.items, s.other].reduce((acc, i) => acc + i.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(summarizeStack({ ...raw.stack, privateRepos: 0 }).includesPrivate, false);
});

test('files map to Linguist languages; generated and vendored files do not count', () => {
  const cases = {
    'app/models/user.rb': 'Ruby',
    'db/migrate/20260101_add_users.rb': 'Ruby',
    Gemfile: 'Ruby',
    'app/views/users/show.html.erb': 'HTML+ERB',
    'web/src/App.tsx': 'TypeScript',
    'tools/sync.py': 'Python',
    'ops/Dockerfile': 'Dockerfile',
    Makefile: 'Makefile',
    'sketch/scanner.ino': 'C++',
    'db/schema.rb': null,
    'db/structure.sql': null,
    'vendor/gems/x/lib/x.rb': null,
    'node_modules/left-pad/index.js': null,
    'app/assets/app.min.js': null,
    'sorbet/rbi/gems/rails.rbi': null,
    'spec/__snapshots__/a.snap.js': null,
    'Gemfile.lock': null,
    'package-lock.json': null,
    'README.md': null,
    'config/database.yml': null,
    '.env': null,
  };
  for (const [file, language] of Object.entries(cases)) assert.equal(languageOf(file), language, file);
});

test('one huge file change is capped, added and removed alike', () => {
  assert.equal(linesChanged({ additions: 40, deletions: 2 }), 42);
  assert.equal(linesChanged({ additions: 90000, deletions: 0 }), 1000);
  assert.deepEqual(splitChanged({ additions: 40, deletions: 2 }), { added: 40, removed: 2 });
  assert.deepEqual(splitChanged({ additions: 3000, deletions: 1000 }), { added: 750, removed: 250 });
});

test('contributions by type, public and private counted the same way', () => {
  const types = summarizeTypes(raw.types, raw.stack);
  assert.deepEqual(types.items.map((i) => [i.key, i.public, i.private]), [
    ['commits', 150, 1130], // from the commits the stack listed
    ['pullRequests', 60, 240],
    ['reviews', 12, 95],
    ['issues', 8, 30],
    ['repositories', 4, 6],
  ]);
  assert.equal(types.includesPrivate, true);
  // Without a read token nothing private is counted, and it says so.
  const publicOnly = summarizeTypes({ public: raw.types.public, incomplete: false }, raw.stack);
  assert.ok(publicOnly.items.every((i) => i.private === null));
  assert.equal(publicOnly.includesPrivate, false);
});

test('calendar weeks, streaks and the busiest days', () => {
  const day = (date, count) => ({ date, count });
  const cal = summarizeCalendar([
    // Out of order on purpose; 2026-03-01 is a Sunday.
    day('2026-03-02', 3), day('2026-03-01', 0), day('2026-03-03', 5), day('2026-03-04', 0),
    day('2026-03-05', 1), day('2026-03-06', 2), day('2026-03-07', 9), day('2026-03-08', 4), day('2026-03-09', 0),
  ]);
  assert.deepEqual(cal.weeks, [{ start: '2026-03-01', count: 20, month: 2 }, { start: '2026-03-08', count: 4, month: null }]);
  assert.equal(cal.activeDays, 6);
  assert.equal(cal.days, 9);
  assert.equal(cal.longestStreak, 4);
  assert.equal(cal.currentStreak, 4); // today (03-09) has not started, so it does not end the streak
  assert.deepEqual(cal.busiestDay, { date: '2026-03-07', count: 9 });
  assert.equal(cal.busiestWeekday, 'SATURDAY');
  assert.equal(summarizeCalendar([day('2026-03-01', 0)]).busiestWeekday, null);

  const full = summarizeCalendar(raw.activity.days);
  assert.equal(full.weeks.reduce((acc, w) => acc + w.count, 0), 1864);
  assert.equal(full.weeks.filter((w) => w.month !== null).length, 12);
  // 53 calendar weeks, but the habits only cover the past year.
  assert.equal(raw.activity.days.length, 371);
  assert.equal(full.days, 365);
});

test('lines are also attributed to the kind of repository they were changed in', () => {
  const sources = summarizeSources(raw.stack.categories, raw.stack.lines);
  assert.deepEqual(sources.map((s) => [s.key, s.commits, s.share, s.main.name]), [
    ['organisation private', 900, 0.75, 'Ruby'],
    ['personal private', 200, 0.2, 'Python'],
    ['personal public', 140, 0.05, 'Ruby'],
  ]);
  assert.deepEqual(summarizeSources(undefined, 0), []);
  const s = summarizeStack(raw.stack);
  assert.equal(s.peakHour, 15);
  assert.equal(s.added + s.removed, s.lines);
});

test('formatting, escaping and exact text measurement', () => {
  assert.equal(formatShare(0.4471), '44.7%');
  assert.equal(formatShare(0.0004), '<0.1%');
  assert.equal(escapeXml(`C# & "F#" <x>`), 'C# &amp; &quot;F#&quot; &lt;x&gt;');
  // Space Mono is monospaced: every glyph is 612/1000 em wide.
  assert.equal(measure('RUBY', 'mono400', 10), 4 * 6.12);
});

const heightOf = (svg) => Number(svg.match(/^<svg [^>]*height="(\d+)"/)[1]);
// Leaves out the embedded fonts, whose base64 could spell anything.
const printed = (svg) => svg.replace(/<style>[\s\S]*?<\/style>/, '');

test('receipts print the numbers, escape names and never print NaN', () => {
  const withOddName = structuredClone(raw);
  withOddName.stack.languages = { 'A&B<C>': 10, Ruby: 5 };
  withOddName.stack.lines = 15;
  for (const input of [raw, withOddName]) {
    const stats = buildStats(input);
    for (const theme of ['light', 'dark']) {
      const { activity, stack } = renderReceipts(stats, theme);
      const header = renderHeader(stats, theme);
      for (const svg of [activity, stack, header]) {
        assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
        assert.doesNotMatch(printed(svg), /NaN|undefined|Infinity|null/);
        assert.match(svg, /@font-face\{font-family:'Receipt';font-weight:700;src:url\(data:font\/woff2;base64,/);
      }
      // Printed to the same height, so they line up side by side.
      assert.equal(heightOf(activity), heightOf(stack));
      assert.match(activity, />1,864</);
      assert.match(activity, />NO\. 001864</);
      assert.match(activity, />BY TYPE</);
      assert.match(activity, />PRS REVIEWED</);
      assert.match(activity, />1,130</); // private commits
      assert.match(activity, />counted from repositories; totals by GitHub</);
      assert.match(activity, />GMT\+8</);
      assert.match(activity, />15:00-16:00</);
      assert.match(activity, />\* PRIVATE INCLUDES COMPANY WORK \*</);
      assert.match(stack, />\*OCTOCAT\*</);
      assert.match(stack, />ORG REPOS, PRIVATE</);
      assert.match(header, />Octo Cat</);
    }
  }
  const stats = buildStats(raw);
  assert.match(renderReceipts(stats, 'light').stack, />public \+ private repositories</);
  assert.match(renderReceipts(stats, 'light').stack, />\+140,000</);
  assert.match(renderReceipts(buildStats(withOddName), 'dark').stack, />A&amp;B&lt;C&gt;</);
});

test('receipts without any code changes or activity say so', () => {
  const empty = structuredClone(raw);
  Object.assign(empty.stack, { languages: {}, lines: 0, added: 0, removed: 0, commits: 0, privateRepos: 0, categories: {}, hours: Array(24).fill(0) });
  Object.assign(empty.activity, { calendarTotal: 0, restricted: 0, days: empty.activity.days.map((d) => ({ ...d, count: 0 })) });
  empty.stack.commitsByVisibility = { public: 0, private: 0 };
  empty.types = { public: { pullRequests: 0, issues: 0, reviews: 0, repositories: 0 }, incomplete: false };
  const { activity, stack } = renderReceipts(buildStats(empty), 'light');
  assert.match(stack, /NO CODE CHANGES FOUND/);
  assert.match(stack, />public repositories only</);
  assert.doesNotMatch(stack, />SOURCE</);
  assert.doesNotMatch(activity, /PEAK HOUR|BUSIEST|COMPANY WORK/);
  assert.match(activity, />-</); // nothing private counted
  for (const svg of [activity, stack]) assert.doesNotMatch(printed(svg), /NaN|undefined|Infinity|null/);
});

test('ranking folds the tail into Other only when it holds several languages', () => {
  assert.equal(rankLanguages({ A: 5, B: 4, C: 3 }, { top: 2 }).other, null);
  assert.deepEqual(rankLanguages({ A: 5, B: 4, C: 3, D: 3 }, { top: 2 }).other, { name: 'Other', lines: 6, share: 6 / 15, count: 2 });
  assert.deepEqual(rankLanguages({}).items, []);
});

test('leak guard catches private names in any case and never repeats them', () => {
  const names = ['acme/billing', 'acme'];
  assert.deepEqual(findLeaks('Ruby 63% ... ACME/Billing', names), ['acme/billing', 'acme']);
  assert.deepEqual(findLeaks('RUBY 63.0% PYTHON 15.0%', names), []);
  assert.throws(() => assertNoLeak('receipt', 'made at Acme', names), (error) =>
    error.message === 'Refusing to publish receipt: it mentions 1 private name(s)');
  const { activity, stack } = renderReceipts(buildStats(raw), 'light');
  assert.doesNotThrow(() => assertNoLeak('receipts', activity + stack, names));
});
