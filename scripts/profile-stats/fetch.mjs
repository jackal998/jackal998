// Reads the raw numbers behind the profile receipts from the GitHub API.
//
// Activity totals use the workflow's own GITHUB_TOKEN, which only sees public
// data; private contributions still arrive as GitHub's anonymous
// `restrictedContributionsCount` when "Private contributions" is enabled, and
// are included in the daily counts of the contribution calendar. (GitHub does
// not itemise them by type, not even for the owner's own `repo` token.)
//
// The language breakdown looks at the files changed in each of the user's
// commits. Optional read-only tokens let it include private repositories.
// Actions logs of a public repository are public, so nothing here ever logs or
// returns a repository name or commit SHA - only aggregated counts leave.

import { languageOf, splitChanged } from './languages.mjs';

const API = 'https://api.github.com';
const ATTEMPTS = 4;
const MAX_WAIT_MS = 120_000;
const DAY_MS = 86_400_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(token, url, init, { sensitive }) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'profile-stats',
          ...init.headers,
        },
      });
    } catch (error) {
      lastError = new Error(`GitHub request failed: ${error.cause?.code ?? error.name}`);
      await sleep(2000 * attempt);
      continue;
    }
    if (res.ok) return res;

    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
    const limited = res.status === 429 ||
      (res.status === 403 && (retryAfter > 0 || res.headers.get('x-ratelimit-remaining') === '0'));
    // Private repository names can appear in error bodies; keep them out of public logs.
    const detail = sensitive ? '' : `: ${(await res.text()).slice(0, 500)}`;
    lastError = Object.assign(new Error(`GitHub API HTTP ${res.status}${limited ? ' (rate limited)' : ''}${detail}`), {
      status: res.status,
      // Set when an organisation's SAML SSO has not authorised this token.
      sso: res.headers.has('x-github-sso'),
      rateLimited: limited,
    });
    if (!(limited || res.status >= 500) || attempt === ATTEMPTS) break;

    const wait = retryAfter ? retryAfter * 1000 : limited && reset ? reset * 1000 - Date.now() + 1000 : 2000 * attempt;
    if (wait > MAX_WAIT_MS) break;
    await sleep(Math.max(wait, 1000));
  }
  throw lastError;
}

// The read token is a classic token whose `repo` scope could also write, so
// this client refuses to: GraphQL queries only, REST GET only.
export async function graphql(token, query, variables, { sensitive = false } = {}) {
  if (/^\s*mutation\b/.test(query)) throw new Error('profile-stats is read-only: GraphQL mutations are not allowed');
  const res = await request(token, `${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  }, { sensitive });
  const body = await res.json();
  if (body.errors?.length) {
    const detail = sensitive ? body.errors.map((e) => e.type ?? 'ERROR').join(', ') : JSON.stringify(body.errors);
    throw new Error(`GitHub GraphQL errors: ${detail}`);
  }
  return body.data;
}

async function rest(token, path, { sensitive = false } = {}) {
  const res = await request(token, `${API}${path}`, { method: 'GET', headers: { 'X-GitHub-Api-Version': '2022-11-28' } }, { sensitive });
  return res.json();
}

// The scopes a classic token was granted (null for other token types). Scope
// names are not secret, and they tell whether private repositories are reachable.
export async function tokenScopes(token) {
  const res = await request(token, `${API}/user`, { method: 'GET', headers: {} }, { sensitive: true });
  return res.headers.get('x-oauth-scopes');
}

// --- Activity: contributions over the past 12 months -------------------------

// Without from/to, contributionsCollection covers the past year: the same
// window as the contribution graph on the profile.
const ACTIVITY_QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
        restrictedContributionsCount
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
        totalRepositoryContributions
      }
    }
  }
`;

// The per-type totals only count public contributions; the private ones are
// all in `restricted`.
export async function fetchActivity({ token, login }) {
  const data = await graphql(token, ACTIVITY_QUERY, { login });
  if (!data.user) throw new Error(`GitHub user "${login}" not found`);
  const c = data.user.contributionsCollection;
  return {
    calendarTotal: c.contributionCalendar.totalContributions,
    restricted: c.restrictedContributionsCount,
    byType: {
      commits: c.totalCommitContributions,
      pullRequests: c.totalPullRequestContributions,
      reviews: c.totalPullRequestReviewContributions,
      issues: c.totalIssueContributions,
      repositories: c.totalRepositoryContributions,
    },
    days: c.contributionCalendar.weeks.flatMap((week) =>
      week.contributionDays.map((day) => ({ date: day.date, count: day.contributionCount }))),
  };
}

// --- Stack: lines changed per language in the user's own commits -------------

const WINDOW_REPOS_QUERY = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        commitContributionsByRepository(maxRepositories: 100) {
          repository { id nameWithOwner isPrivate }
        }
      }
    }
  }
`;

async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

const repoPath = (nameWithOwner) => nameWithOwner.split('/').map(encodeURIComponent).join('/');

// A repository the token can list but not read (no access, SSO not
// authorised, empty, blocked) is skipped instead of failing the whole run.
// A rate limit is not a repository problem: skipping would publish numbers
// missing whatever was left, so it fails the run and keeps the last receipts.
const UNREADABLE = new Set([403, 404, 409, 451]);
async function orSkip(promise, onSkip) {
  try {
    return await promise;
  } catch (error) {
    if (!UNREADABLE.has(error.status) || error.rateLimited) throw error;
    onSkip(error);
    return null;
  }
}

// Repositories this token can see that the user committed to inside the window.
async function reposFor(source, login, from, to) {
  const found = new Map();
  const data = await graphql(source.token, WINDOW_REPOS_QUERY, { login, from: from.toISOString(), to: to.toISOString() }, source);
  for (const { repository: r } of data.user.contributionsCollection.commitContributionsByRepository) {
    found.set(r.id, { id: r.id, nameWithOwner: r.nameWithOwner, isPrivate: r.isPrivate });
  }
  // The contribution graph can leave out private repositories for some token
  // types, so read tokens also list every repository they can reach directly.
  if (source.listAll) {
    for (let page = 1; page <= 20; page++) {
      const repos = await rest(source.token, `/user/repos?per_page=100&page=${page}&sort=pushed`, source);
      for (const r of repos) {
        if (new Date(r.pushed_at) >= from && !found.has(r.node_id)) {
          found.set(r.node_id, { id: r.node_id, nameWithOwner: r.full_name, isPrivate: r.private });
        }
      }
      if (repos.length < 100) break;
    }
  }
  return [...found.values()];
}

async function commitsIn(source, repo, login, from, to) {
  const commits = [];
  for (let page = 1; page <= 50; page++) {
    const query = `author=${encodeURIComponent(login)}&since=${from.toISOString()}&until=${to.toISOString()}&per_page=100&page=${page}`;
    const list = await rest(source.token, `/repos/${repoPath(repo.nameWithOwner)}/commits?${query}`, source);
    for (const c of list) commits.push({ sha: c.sha, date: c.commit.author?.date ?? c.commit.committer?.date, repo, source });
    if (list.length < 100) break;
  }
  return commits;
}

// Where a commit was made, for the aggregated breakdown by kind of repository.
export function categoryOf(repo, login) {
  const owner = repo.nameWithOwner.split('/')[0].toLowerCase();
  if (owner === login.toLowerCase()) return repo.isPrivate ? 'personal private' : 'personal public';
  return repo.isPrivate ? 'organisation private' : 'public, other owners';
}

const addTo = (bag, key, n) => { bag[key] = (bag[key] ?? 0) + n; };

/**
 * sources: [{ token, label, listAll, sensitive, maxCommits }], most capable first.
 * A repository is read with the first source that can see it. Commit times are
 * bucketed by hour of day in `timeZone`.
 */
export async function fetchStack({ sources, login, now = new Date(), windowDays = 365, timeZone = 'UTC' }) {
  const to = now;
  const from = new Date(now.getTime() - windowDays * DAY_MS);
  const hourOf = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
  const claimed = new Map();
  const perSource = [];

  for (const source of sources) {
    const repos = await reposFor(source, login, from, to);
    const mine = repos.filter((r) => !claimed.has(r.id));
    for (const r of mine) claimed.set(r.id, { ...r, source });
    perSource.push({ source, repos: mine });
  }

  const languages = {};
  let commits = 0;
  let added = 0;
  let removed = 0;
  let capped = false;
  const hours = Array(24).fill(0);
  const log = [];
  const withCommits = new Set(); // repositories whose commits were actually read
  const privateRead = new Set();
  // Aggregated per kind of repository. Also a health check in the logs: if the
  // organisation line drops to zero, the read token lost access.
  const categories = {};

  for (const { source, repos } of perSource) {
    let listed = [];
    let skipped = 0;
    let ssoBlocked = 0;
    const skip = (error) => { skipped++; if (error.sso) ssoBlocked++; };
    const read = [];
    for (const repo of repos) {
      const found = await orSkip(commitsIn(source, repo, login, from, to), skip);
      if (found === null) continue;
      read.push(repo);
      listed.push(...found);
      if (!found.length) continue;
      withCommits.add(repo.id);
      if (repo.isPrivate) privateRead.add(repo.id);
    }
    listed.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (listed.length > source.maxCommits) {
      listed = listed.slice(0, source.maxCommits);
      capped = true;
    }

    let analyzed = 0;
    await pool(listed, 6, async (c) => {
      const detail = await orSkip(rest(source.token, `/repos/${repoPath(c.repo.nameWithOwner)}/commits/${c.sha}`, source), () => {});
      if (!detail) return;
      if ((detail.parents?.length ?? 0) > 1) return; // merge commits repeat work already counted
      analyzed++;
      if (c.date) hours[Number(hourOf.format(new Date(c.date))) % 24]++;
      const category = (categories[categoryOf(c.repo, login)] ??= { commits: 0, lines: 0, languages: {} });
      category.commits++;
      for (const file of detail.files ?? []) {
        const language = languageOf(file.filename);
        if (!language) continue;
        const change = splitChanged(file);
        const n = change.added + change.removed;
        addTo(languages, language, n);
        addTo(category.languages, language, n);
        added += change.added;
        removed += change.removed;
        category.lines += n;
      }
    });
    commits += analyzed;
    log.push({
      label: source.label,
      repos: read.length,
      privateRepos: read.filter((r) => r.isPrivate).length,
      skipped,
      ssoBlocked,
      commits: analyzed,
    });
  }

  // Unreadable repositories still count as seen: their names must stay secret too.
  const privateRepos = [...claimed.values()].filter((r) => r.isPrivate);
  // Names that must never reach the receipt or the logs; see guard.mjs.
  const secretNames = new Set();
  for (const r of privateRepos) {
    secretNames.add(r.nameWithOwner);
    const owner = r.nameWithOwner.split('/')[0];
    if (owner.toLowerCase() !== login.toLowerCase()) secretNames.add(owner);
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    commits,
    lines: added + removed,
    added,
    removed,
    languages,
    categories,
    hours,
    timeZone,
    repos: claimed.size,
    reposWithCommits: withCommits.size,
    privateRepos: privateRead.size,
    capped,
    log,
    secretNames: [...secretNames],
  };
}
