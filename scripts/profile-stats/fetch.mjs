// Reads the raw numbers behind the profile receipt from the GitHub API.
//
// Activity totals use the workflow's own GITHUB_TOKEN, which only sees public
// data; private contributions still arrive as GitHub's anonymous per-year
// `restrictedContributionsCount` when "Private contributions" is enabled.
//
// The language breakdown looks at the files changed in each of the user's
// commits. Optional read-only tokens let it include private repositories.
// Actions logs of a public repository are public, so nothing here ever logs or
// returns a repository name or commit SHA - only aggregated counts leave.

import { languageOf, linesChanged } from './languages.mjs';

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
    lastError = Object.assign(new Error(`GitHub API HTTP ${res.status}${detail}`), {
      status: res.status,
      // Set when an organisation's SAML SSO has not authorised this token.
      sso: res.headers.has('x-github-sso'),
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

// --- Activity: contribution totals per year --------------------------------

const OVERVIEW_QUERY = `
  query ($login: String!) {
    user(login: $login) {
      createdAt
      contributionsCollection {
        contributionYears
        contributionCalendar { totalContributions }
        restrictedContributionsCount
      }
    }
  }
`;

const YEAR_FIELDS = `
  contributionCalendar { totalContributions }
  restrictedContributionsCount
`;

// One aliased contributionsCollection per calendar year, in a single request.
// The API caps each collection at a one-year span.
function yearsQuery(years, now) {
  const collections = years.map((year) => {
    const from = `${year}-01-01T00:00:00Z`;
    const to = year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z`;
    return `y${year}: contributionsCollection(from: "${from}", to: "${to}") { ${YEAR_FIELDS} }`;
  });
  return `query ($login: String!) { user(login: $login) { ${collections.join('\n')} } }`;
}

export async function fetchActivity({ token, login, now = new Date() }) {
  const overview = await graphql(token, OVERVIEW_QUERY, { login });
  if (!overview.user) throw new Error(`GitHub user "${login}" not found`);
  const pastYear = overview.user.contributionsCollection;

  const firstYear = Math.min(
    new Date(overview.user.createdAt).getUTCFullYear(),
    ...pastYear.contributionYears,
    now.getUTCFullYear(),
  );
  const yearList = [];
  for (let year = firstYear; year <= now.getUTCFullYear(); year++) yearList.push(year);

  const yearly = await graphql(token, yearsQuery(yearList, now), { login });
  return {
    pastYear: {
      calendarTotal: pastYear.contributionCalendar.totalContributions,
      restricted: pastYear.restrictedContributionsCount,
    },
    years: yearList.map((year) => ({
      year,
      calendarTotal: yearly.user[`y${year}`].contributionCalendar.totalContributions,
      restricted: yearly.user[`y${year}`].restrictedContributionsCount,
    })),
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
const UNREADABLE = new Set([403, 404, 409, 451]);
async function orSkip(promise, onSkip) {
  try {
    return await promise;
  } catch (error) {
    if (!UNREADABLE.has(error.status)) throw error;
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

/**
 * sources: [{ token, label, listAll, sensitive, maxCommits }], most capable first.
 * A repository is read with the first source that can see it.
 */
export async function fetchStack({ sources, login, now = new Date(), windowDays = 365 }) {
  const to = now;
  const from = new Date(now.getTime() - windowDays * DAY_MS);
  const claimed = new Map();
  const perSource = [];

  for (const source of sources) {
    const repos = await reposFor(source, login, from, to);
    const mine = repos.filter((r) => !claimed.has(r.id));
    for (const r of mine) claimed.set(r.id, { ...r, source });
    perSource.push({ source, repos: mine });
  }

  const languages = {};
  // For comparison only: what GitHub's own data suggests - each repository's
  // language mix (by bytes, as on its language bar) weighted by my commit count.
  const estimate = {};
  let commits = 0;
  let lines = 0;
  let capped = false;
  const log = [];
  const privateRead = new Set(); // private repositories whose commits were actually read

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
      if (repo.isPrivate) privateRead.add(repo.id);
      const bytes = await orSkip(rest(source.token, `/repos/${repoPath(repo.nameWithOwner)}/languages`, source), () => {});
      if (!bytes) continue;
      const total = Object.values(bytes).reduce((acc, n) => acc + n, 0);
      if (!total) continue;
      for (const [name, n] of Object.entries(bytes)) estimate[name] = (estimate[name] ?? 0) + (n / total) * found.length;
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
      for (const file of detail.files ?? []) {
        const language = languageOf(file.filename);
        if (!language) continue;
        const n = linesChanged(file);
        languages[language] = (languages[language] ?? 0) + n;
        lines += n;
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
    lines,
    languages,
    estimate,
    repos: claimed.size,
    privateRepos: privateRead.size,
    capped,
    log,
    secretNames: [...secretNames],
  };
}
