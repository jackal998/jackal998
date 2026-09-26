import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { activityRows, buildStats, rankLanguages, summarizeContributions, summarizeStack } from '../aggregate.mjs';
import { assertNoLeak, findLeaks } from '../guard.mjs';
import { languageOf, linesChanged } from '../languages.mjs';
import { escapeXml, formatShare, measure, renderReceipt } from '../render.mjs';

const raw = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));

test('contributions split every year into public and private', () => {
  const c = summarizeContributions(raw.activity);
  assert.equal(c.total, 8422);
  assert.equal(c.private, 7043);
  assert.equal(c.public, c.total - c.private);
  assert.equal(c.firstYear, 2016);
  assert.deepEqual(c.pastYear, { total: 1864, private: 1502, public: 362 });
});

test('refuses to publish when private exceeds the calendar total', () => {
  const broken = structuredClone(raw.activity);
  broken.years[3].restricted = 5;
  assert.throws(() => summarizeContributions(broken), /2019: private contributions \(5\) exceed/);
});

test('early low-activity years fold into one line without losing contributions', () => {
  const years = summarizeContributions(raw.activity).years;
  const rows = activityRows(years);
  assert.deepEqual(rows.slice(0, 2), [{ label: '2016-20', total: 112 }, { label: '2021', total: 310 }]);
  assert.equal(rows.length, 7);
  assert.equal(rows.reduce((acc, r) => acc + r.total, 0), 8422);
  // Nothing to fold when activity starts in the first or second year.
  assert.equal(activityRows(years.slice(5)).length, 6);
  assert.deepEqual(activityRows([{ year: 2020, total: 3 }, { year: 2021, total: 500 }]).map((r) => r.label), ['2020', '2021']);
  assert.equal(activityRows([{ year: 2020, total: 3 }, { year: 2021, total: 5 }]).length, 2);
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

test('one huge file change is capped', () => {
  assert.equal(linesChanged({ additions: 40, deletions: 2 }), 42);
  assert.equal(linesChanged({ additions: 90000, deletions: 0 }), 1000);
});

test('formatting, escaping and exact text measurement', () => {
  assert.equal(formatShare(0.4471), '44.7%');
  assert.equal(formatShare(0.0004), '<0.1%');
  assert.equal(escapeXml(`C# & "F#" <x>`), 'C# &amp; &quot;F#&quot; &lt;x&gt;');
  // Space Mono is monospaced: every glyph is 612/1000 em wide.
  assert.equal(measure('RUBY', 'mono400', 10), 4 * 6.12);
});

test('receipt prints the numbers, escapes names and never prints NaN', () => {
  const withOddName = structuredClone(raw);
  withOddName.stack.languages = { 'A&B<C>': 10, Ruby: 5 };
  withOddName.stack.lines = 15;
  for (const input of [raw, withOddName]) {
    const stats = buildStats(input);
    for (const theme of ['light', 'dark']) {
      const svg = renderReceipt(stats, theme);
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
      assert.match(svg, />8,422</);
      assert.match(svg, />2016-20</);
      assert.match(svg, />NO\. 008422</);
      assert.match(svg, />\*OCTOCAT\*</);
      assert.match(svg, /@font-face\{font-family:'Receipt';font-weight:700;src:url\(data:font\/woff2;base64,/);
    }
  }
  assert.match(renderReceipt(buildStats(raw), 'light'), />PUBLIC \+ PRIVATE</);
  assert.match(renderReceipt(buildStats(withOddName), 'dark'), />A&amp;B&lt;C&gt;</);
});

test('receipt without any code changes says so', () => {
  const empty = structuredClone(raw);
  Object.assign(empty.stack, { languages: {}, lines: 0, commits: 0, privateRepos: 0 });
  const svg = renderReceipt(buildStats(empty), 'light');
  assert.match(svg, /NO CODE CHANGES FOUND/);
  assert.match(svg, />PUBLIC ONLY</);
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
  assert.doesNotThrow(() => assertNoLeak('receipt', renderReceipt(buildStats(raw), 'light'), names));
});
