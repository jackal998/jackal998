import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchRaw } from '../fetch.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

const year = (total, restricted) => ({
  contributionCalendar: { totalContributions: total },
  restrictedContributionsCount: restricted,
  totalCommitContributions: total - restricted,
  totalIssueContributions: 0,
  totalPullRequestContributions: 0,
  totalPullRequestReviewContributions: 0,
  totalRepositoryContributions: 0,
});

test('fetchRaw maps overview, per-year collections and paginated repositories', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables, auth: init.headers.Authorization });
    if (query.includes('createdAt')) {
      return json({ data: { user: { createdAt: '2024-05-01T00:00:00Z', contributionsCollection: {
        contributionYears: [2026, 2025], contributionCalendar: { totalContributions: 40 }, restrictedContributionsCount: 30 } } } });
    }
    if (query.includes('y2024:')) {
      assert.match(query, /y2026: contributionsCollection\(from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00.000Z"\)/);
      return json({ data: { user: { y2024: year(5, 0), y2025: year(20, 15), y2026: year(10, 8) } } });
    }
    const page = variables.cursor
      ? { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ name: 'b', languages: { edges: [] } }] }
      : { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [{ name: 'a', languages: { edges: [{ size: 7, node: { name: 'Ruby' } }] } }] };
    return json({ data: { user: { repositories: page } } });
  };

  const raw = await fetchRaw({ token: 't0k', login: 'someone', now: new Date('2026-03-01T00:00:00Z') });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.auth === 'bearer t0k' && c.variables.login === 'someone'));
  assert.deepEqual(raw.pastYear, { calendarTotal: 40, restricted: 30 });
  assert.deepEqual(raw.years.map((y) => [y.year, y.calendarTotal, y.restricted]), [[2024, 5, 0], [2025, 20, 15], [2026, 10, 8]]);
  assert.deepEqual(raw.repos, [{ name: 'a', languages: [{ name: 'Ruby', size: 7 }] }, { name: 'b', languages: [] }]);
});

test('GraphQL errors fail immediately instead of producing cards', async () => {
  let count = 0;
  globalThis.fetch = async () => { count++; return json({ errors: [{ message: 'nope' }] }); };
  await assert.rejects(fetchRaw({ token: 't', login: 'x' }), /GitHub GraphQL errors: .*nope/);
  assert.equal(count, 1);
});

test('unknown user is an error', async () => {
  globalThis.fetch = async () => json({ data: { user: null } });
  await assert.rejects(fetchRaw({ token: 't', login: 'ghost' }), /"ghost" not found/);
});
