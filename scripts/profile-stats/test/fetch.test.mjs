import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { categoryOf, fetchActivity, fetchStack, graphql } from '../fetch.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body, status = 200, headers = {}) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('fetchActivity maps the overview and one collection per year', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ auth: init.headers.Authorization, login: variables.login });
    if (query.includes('createdAt')) {
      return json({ data: { user: { createdAt: '2024-05-01T00:00:00Z', contributionsCollection: {
        contributionYears: [2026, 2025], contributionCalendar: { totalContributions: 40 }, restrictedContributionsCount: 30 } } } });
    }
    assert.match(query, /y2026: contributionsCollection\(from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00.000Z"\)/);
    const year = (total, restricted) => ({ contributionCalendar: { totalContributions: total }, restrictedContributionsCount: restricted });
    return json({ data: { user: { y2024: year(5, 0), y2025: year(20, 15), y2026: year(10, 8) } } });
  };

  const activity = await fetchActivity({ token: 't0k', login: 'someone', now: new Date('2026-03-01T00:00:00Z') });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.auth === 'Bearer t0k' && c.login === 'someone'));
  assert.deepEqual(activity.pastYear, { calendarTotal: 40, restricted: 30 });
  assert.deepEqual(activity.years.map((y) => [y.year, y.calendarTotal, y.restricted]), [[2024, 5, 0], [2025, 20, 15], [2026, 10, 8]]);
});

test('unknown user is an error', async () => {
  globalThis.fetch = async () => json({ data: { user: null } });
  await assert.rejects(fetchActivity({ token: 't', login: 'ghost' }), /"ghost" not found/);
});

// A small GitHub: a private work repo only the work token sees, and a public
// repo both tokens see (it must be read once, with the first token).
function fakeGitHub({ failWith, unreadable = {} } = {}) {
  const seen = { detail: [], lists: [] };
  const repos = {
    work: { id: 'R_work', nameWithOwner: 'acme/billing', isPrivate: true },
    pub: { id: 'R_pub', nameWithOwner: 'me/tool', isPrivate: false },
  };
  const commits = {
    'acme/billing': [
      { sha: 'a1', date: '2026-02-01T00:00:00Z', parents: 1, files: [
        { filename: 'app/models/invoice.rb', additions: 30, deletions: 10 },
        { filename: 'db/schema.rb', additions: 500, deletions: 0 },
        { filename: 'app/views/invoices/show.html.erb', additions: 5, deletions: 5 },
      ] },
      { sha: 'a2', date: '2026-02-03T00:00:00Z', parents: 2, files: [{ filename: 'app/models/invoice.rb', additions: 30, deletions: 10 }] },
      { sha: 'a3', date: '2026-01-10T00:00:00Z', parents: 1, files: [{ filename: 'lib/tasks/x.rake', additions: 5000, deletions: 0 }] },
      { sha: 'a4', date: '2026-01-05T00:00:00Z', parents: 1, files: [{ filename: 'app/old.rb', additions: 0, deletions: 0 }] },
    ],
    'me/tool': [
      { sha: 'b1', date: '2026-02-02T00:00:00Z', parents: 1, files: [{ filename: 'src/main.py', additions: 12, deletions: 3 }] },
    ],
  };
  globalThis.fetch = async (url, init) => {
    const token = init.headers.Authorization.replace('Bearer ', '');
    const u = new URL(url);
    if (failWith && token === 'work') return json({ message: 'Not Found: acme/billing' }, failWith);
    if (u.pathname === '/graphql') {
      const visible = token === 'work' ? [repos.work, repos.pub] : [repos.pub];
      return json({ data: { user: { contributionsCollection: {
        commitContributionsByRepository: visible.map((repository) => ({ repository })),
      } } } });
    }
    if (u.pathname === '/user/repos') {
      return json(token === 'work'
        ? [{ node_id: 'R_work', full_name: 'acme/billing', private: true, pushed_at: '2026-02-03T00:00:00Z' },
          { node_id: 'R_old', full_name: 'acme/legacy', private: true, pushed_at: '2019-01-01T00:00:00Z' }]
        : []);
    }
    const langs = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/languages$/);
    if (langs) return json({ 'acme/billing': { Ruby: 9000, JavaScript: 1000 }, 'me/tool': { Python: 500 } }[langs[1]]);
    const list = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/commits$/);
    if (list) {
      const blocked = unreadable[list[1]];
      if (blocked) {
        return json({ message: `blocked: ${list[1]}` }, blocked.status,
          blocked.sso ? { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=x' } : {});
      }
      assert.equal(u.searchParams.get('author'), 'me');
      seen.lists.push(`${token}:${list[1]}`);
      return json((commits[list[1]] ?? []).map((c) => ({ sha: c.sha, commit: { author: { date: c.date } } })));
    }
    const one = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/commits\/(\w+)$/);
    if (one) {
      seen.detail.push(`${token}:${one[2]}`);
      const c = commits[one[1]].find((x) => x.sha === one[2]);
      return json({ parents: Array.from({ length: c.parents }), files: c.files });
    }
    throw new Error(`unexpected request ${url}`);
  };
  return seen;
}

const sources = [
  { label: 'work', token: 'work', listAll: true, sensitive: true, maxCommits: 100 },
  { label: 'default', token: 'gh', listAll: false, sensitive: false, maxCommits: 100 },
];

test('fetchStack counts lines per language in the user\'s own commits', async () => {
  const seen = fakeGitHub();
  const stack = await fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') });
  // Merge commit a2 is skipped, db/schema.rb is generated, the 5000-line rake file is capped.
  assert.deepEqual(stack.languages, { Ruby: 40 + 1000, 'HTML+ERB': 10, Python: 15 });
  assert.equal(stack.lines, 1065);
  assert.equal(stack.commits, 4); // includes a4, a rename that changes no lines
  assert.equal(stack.repos, 2);
  assert.equal(stack.privateRepos, 1);
  assert.equal(stack.capped, false);
  // The public repo is read once, with the first token that could see it; the
  // repository not pushed to inside the window is never listed.
  assert.deepEqual(seen.lists.sort(), ['work:acme/billing', 'work:me/tool']);
  assert.ok(seen.detail.every((d) => d.startsWith('work:')));
  assert.deepEqual(stack.log, [
    { label: 'work', repos: 2, privateRepos: 1, skipped: 0, ssoBlocked: 0, commits: 4 },
    { label: 'default', repos: 0, privateRepos: 0, skipped: 0, ssoBlocked: 0, commits: 0 },
  ]);
  // GitHub's own view for comparison: repo language bytes weighted by my commits.
  assert.deepEqual(Object.fromEntries(Object.entries(stack.estimate).map(([k, v]) => [k, +v.toFixed(3)])),
    { Ruby: 3.6, JavaScript: 0.4, Python: 1 });
  // Private repositories and their (non-personal) owners are handed to the leak guard.
  assert.deepEqual(stack.secretNames.sort(), ['acme', 'acme/billing']);
});

test('commits are also summarised per commit and per kind of repository', async () => {
  fakeGitHub();
  const stack = await fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') });
  // a1: 40 Ruby + 10 ERB lines -> 0.8 / 0.2 of a commit; a3: all Ruby; b1: all Python.
  assert.deepEqual(stack.perCommit, { Ruby: 1.8, 'HTML+ERB': 0.2, Python: 1 });
  assert.deepEqual(Object.keys(stack.categories).sort(), ['organisation private', 'personal public']);
  assert.ok(Object.values(stack.perCommit).every(Number.isFinite));
  assert.deepEqual(stack.categories['organisation private'], {
    commits: 3, lines: 1050, languages: { Ruby: 1040, 'HTML+ERB': 10 }, perCommit: { Ruby: 1.8, 'HTML+ERB': 0.2 },
  });
  assert.equal(stack.categories['personal public'].commits, 1);
});

test('repositories are grouped by owner and visibility', () => {
  assert.equal(categoryOf({ nameWithOwner: 'Me/tool', isPrivate: true }, 'me'), 'personal private');
  assert.equal(categoryOf({ nameWithOwner: 'me/tool', isPrivate: false }, 'me'), 'personal public');
  assert.equal(categoryOf({ nameWithOwner: 'acme/billing', isPrivate: true }, 'me'), 'organisation private');
  assert.equal(categoryOf({ nameWithOwner: 'rails/rails', isPrivate: false }, 'me'), 'public, other owners');
});

test('the client refuses to write, whatever the token could do', async () => {
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  await assert.rejects(graphql('t', 'mutation { deleteRepository(input: {}) { clientMutationId } }', {}), /read-only/);
});

test('fetchStack keeps only the most recent commits past the cap', async () => {
  const seen = fakeGitHub();
  const stack = await fetchStack({ sources: [{ ...sources[0], maxCommits: 2 }], login: 'me', now: new Date('2026-03-01T00:00:00Z') });
  assert.equal(stack.capped, true);
  assert.deepEqual(seen.detail.sort(), ['work:a2', 'work:b1']);
});

test('errors from a read token never echo response bodies into logs', async () => {
  fakeGitHub({ failWith: 404 });
  await assert.rejects(
    fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') }),
    (error) => error.message === 'GitHub API HTTP 404' && !error.message.includes('acme'),
  );
});

test('repositories the token cannot read are skipped, never fatal, and stay secret', async () => {
  fakeGitHub({ unreadable: { 'acme/billing': { status: 403, sso: true } } });
  const stack = await fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') });
  assert.deepEqual(stack.log[0], { label: 'work', repos: 1, privateRepos: 0, skipped: 1, ssoBlocked: 1, commits: 1 });
  assert.deepEqual(stack.languages, { Python: 15 });
  // Nothing private was read, so the receipt must not claim otherwise ...
  assert.equal(stack.privateRepos, 0);
  // ... but the name it saw is still guarded.
  assert.deepEqual(stack.secretNames.sort(), ['acme', 'acme/billing']);

  fakeGitHub({ unreadable: { 'acme/billing': { status: 409 } } });
  const empty = await fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') });
  assert.equal(empty.log[0].skipped, 1);
  assert.equal(empty.log[0].ssoBlocked, 0);
});

test('other failures still stop the run', async () => {
  fakeGitHub({ unreadable: { 'acme/billing': { status: 401 } } });
  await assert.rejects(fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') }), /HTTP 401/);
});
