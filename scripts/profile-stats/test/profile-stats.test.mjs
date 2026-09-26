import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildStats, summarizeContributions, summarizeLanguages } from '../aggregate.mjs';
import { escapeXml, formatShare, niceScale, renderContributionsCard, renderLanguagesCard } from '../render.mjs';

const raw = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));

test('contributions split every year into public and private', () => {
  const c = summarizeContributions(raw);
  assert.equal(c.total, 8422);
  assert.equal(c.private, 7043);
  assert.equal(c.public, c.total - c.private);
  assert.equal(c.firstYear, 2016);
  assert.deepEqual(c.pastYear, { total: 1864, private: 1502, public: 362 });
  assert.deepEqual(c.years.at(-1), { year: 2026, total: 1391, private: 1102, public: 289 });
});

test('refuses to publish when private exceeds the calendar total', () => {
  const broken = structuredClone(raw);
  broken.years[3].restricted = 5;
  assert.throws(() => summarizeContributions(broken), /2019: private contributions \(5\) exceed/);
});

test('languages add up across repositories and fold the tail into Other', () => {
  const langs = summarizeLanguages(raw.repos);
  assert.equal(langs.totalSize, 498400);
  assert.deepEqual(langs.items.map((i) => i.name), ['Ruby', 'Python', 'HTML', 'JavaScript', 'C', 'SCSS']);
  assert.equal(langs.items[0].size, 223000);
  assert.equal(langs.other.count, 4);
  assert.equal(langs.other.size, 5200 + 3100 + 2400 + 700);
  const shares = [...langs.items, langs.other].reduce((acc, i) => acc + i.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);
});

test('a single leftover language keeps its name instead of becoming Other', () => {
  const repos = [{ name: 'r', languages: 'ABCDEFG'.split('').map((name, i) => ({ name, size: 100 - i })) }];
  const langs = summarizeLanguages(repos);
  assert.equal(langs.items.length, 7);
  assert.equal(langs.other, null);
});

test('no languages at all renders an empty-state card', () => {
  const stats = buildStats({ ...raw, repos: [] });
  assert.match(renderLanguagesCard(stats, 'light'), /No language data yet/);
});

test('axis ticks use whole, round steps', () => {
  assert.deepEqual(niceScale(1830), { max: 2000, step: 500 });
  assert.deepEqual(niceScale(3), { max: 3, step: 1 });
  assert.deepEqual(niceScale(10), { max: 10, step: 5 });
  assert.deepEqual(niceScale(0), { max: 1, step: 1 });
});

test('formatting and escaping', () => {
  assert.equal(formatShare(0.4471), '44.7%');
  assert.equal(formatShare(0.0004), '<0.1%');
  assert.equal(escapeXml(`C# & "F#" <x>`), 'C# &amp; &quot;F#&quot; &lt;x&gt;');
});

test('cards render numbers, escape names and never print NaN', () => {
  const stats = buildStats({ ...raw, repos: [...raw.repos, { name: 'x', languages: [{ name: 'A&B<C>', size: 900000 }] }] });
  for (const theme of ['light', 'dark']) {
    const contributions = renderContributionsCard(stats, theme);
    const languages = renderLanguagesCard(stats, theme);
    for (const svg of [contributions, languages]) {
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    }
    assert.match(contributions, />8,422</);
    assert.match(contributions, /Updated 2026-09-26/);
    assert.match(languages, />A&amp;B&lt;C&gt;</);
    assert.doesNotMatch(languages, /A&B<C>/);
  }
});
