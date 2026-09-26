import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { categoryOf, fetchActivity, fetchStack, fetchTypes, graphql } from '../fetch.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body, status = 200, headers = {}) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('fetchActivity reads the past year of contributions in one query', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ auth: init.headers.Authorization, login: variables.login });
    assert.doesNotMatch(query, /from:/); // the default window is the past year
    return json({ data: { user: { contributionsCollection: {
      contributionCalendar: { totalContributions: 40, weeks: [
        { contributionDays: [{ date: '2026-03-07', contributionCount: 25 }] },
        { contributionDays: [{ date: '2026-03-08', contributionCount: 15 }, { date: '2026-03-09', contributionCount: 0 }] },
      ] },
      restrictedContributionsCount: 30,
    } } } });
  };

  const activity = await fetchActivity({ token: 't0k', login: 'someone' });
  assert.deepEqual(calls, [{ auth: 'Bearer t0k', login: 'someone' }]);
  assert.deepEqual(activity, {
    calendarTotal: 40,
    restricted: 30,
    days: [{ date: '2026-03-07', count: 25 }, { date: '2026-03-08', count: 15 }, { date: '2026-03-09', count: 0 }],
  });
});

test('types are searched for public and private work alike', async () => {
  const queries = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    assert.equal(init.method, 'GET');
    const q = u.searchParams.get('q');
    queries.push(`${u.pathname} ${q}`);
    const visibility = q.endsWith('is:private') ? 2 : 1;
    const base = { '/search/repositories': 1, '/search/issues': q.startsWith('is:pr reviewed-by') ? 3 : q.startsWith('is:pr') ? 10 : 5 }[u.pathname];
    return json({ total_count: base * visibility, incomplete_results: false });
  };
  const types = await fetchTypes({ source: { token: 't', sensitive: true }, login: 'me', now: new Date('2026-03-01T00:00:00Z'), includePrivate: true });
  assert.deepEqual(types, {
    incomplete: false,
    public: { pullRequests: 10, issues: 5, reviews: 3, repositories: 1 },
    private: { pullRequests: 20, issues: 10, reviews: 6, repositories: 2 },
  });
  assert.equal(queries.length, 8);
  assert.ok(queries.includes('/search/issues is:pr author:me created:2025-03-01..2026-03-01 is:private'));
  assert.ok(queries.includes('/search/issues is:pr reviewed-by:me -author:me created:2025-03-01..2026-03-01 is:public'));
  assert.ok(queries.includes('/search/repositories user:me created:2025-03-01..2026-03-01 is:private'));

  const publicOnly = await fetchTypes({ source: { token: 't' }, login: 'me', now: new Date('2026-03-01T00:00:00Z') });
  assert.equal(publicOnly.private, undefined);
  assert.deepEqual(publicOnly.public, { pullRequests: 10, issues: 5, reviews: 3, repositories: 1 });
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
    const list = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/commits$/);
    if (list) {
      const blocked = unreadable[list[1]];
      if (blocked) {
        return json({ message: `blocked: ${list[1]}` }, blocked.status, {
          ...(blocked.sso ? { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=x' } : {}),
          // Out of requests until an hour from now: too long to wait for.
          ...(blocked.rateLimited ? { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) } : {}),
        });
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
  assert.deepEqual([stack.added, stack.removed], [30 + 5 + 1000 + 12, 10 + 5 + 3]);
  assert.equal(stack.commits, 4); // includes a4, a rename that changes no lines
  // Every commit listed, merge a2 included, as GitHub counts contributions.
  assert.deepEqual(stack.commitsByVisibility, { public: 1, private: 4 });
  assert.equal(stack.repos, 2);
  assert.equal(stack.reposWithCommits, 2);
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
  // Private repositories and their (non-personal) owners are handed to the leak guard.
  assert.deepEqual(stack.secretNames.sort(), ['acme', 'acme/billing']);
});

test('commit times are bucketed by hour in the profile\'s time zone', async () => {
  fakeGitHub();
  const stack = await fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z'), timeZone: 'Asia/Taipei' });
  // a1, a3, a4 and b1 were all made at 00:00 UTC, which is 08:00 in Taipei.
  assert.equal(stack.hours[8], 4);
  assert.equal(stack.hours.reduce((acc, n) => acc + n, 0), 4);
  assert.equal(stack.timeZone, 'Asia/Taipei');
});

test('commits are also summarised per kind of repository', async () => {
  fakeGitHub();
  const stack = await fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') });
  assert.deepEqual(Object.keys(stack.categories).sort(), ['organisation private', 'personal public']);
  // a1, a3 and the rename-only a4 are read; merge commit a2 is not.
  assert.deepEqual(stack.categories['organisation private'], { commits: 3, lines: 1050, languages: { Ruby: 1040, 'HTML+ERB': 10 } });
  assert.deepEqual(stack.categories['personal public'], { commits: 1, lines: 15, languages: { Python: 15 } });
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

test('a rate limit stops the run instead of skipping the repository', async () => {
  fakeGitHub({ unreadable: { 'acme/billing': { status: 403, rateLimited: true } } });
  await assert.rejects(
    fetchStack({ sources, login: 'me', now: new Date('2026-03-01T00:00:00Z') }),
    (error) => error.message === 'GitHub API HTTP 403 (rate limited)' && error.rateLimited,
  );
});
