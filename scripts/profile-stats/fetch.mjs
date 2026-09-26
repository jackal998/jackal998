// Reads the raw numbers behind the profile cards from the GitHub GraphQL API.
//
// Runs with the workflow's short-lived GITHUB_TOKEN, which only sees public
// data. Private contributions still arrive, as the anonymous per-year
// `restrictedContributionsCount` GitHub exposes when "Private contributions"
// is enabled on the profile - no repository names or details.

const ENDPOINT = 'https://api.github.com/graphql';
const ATTEMPTS = 3;

async function graphql(token, query, variables) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'profile-stats',
        },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status >= 500) throw new Error(`GitHub GraphQL HTTP ${res.status}`);
      if (!res.ok) {
        // 4xx will not fix itself on retry.
        throw Object.assign(new Error(`GitHub GraphQL HTTP ${res.status}: ${await res.text()}`), { fatal: true });
      }
      const body = await res.json();
      if (body.errors?.length) {
        throw Object.assign(new Error(`GitHub GraphQL errors: ${JSON.stringify(body.errors)}`), { fatal: true });
      }
      return body.data;
    } catch (error) {
      lastError = error;
      if (error.fatal || attempt === ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
}

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

const REPOS_QUERY = `
  query ($login: String!, $cursor: String) {
    user(login: $login) {
      repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          languages(first: 100) { edges { size node { name } } }
        }
      }
    }
  }
`;

const YEAR_FIELDS = `
  contributionCalendar { totalContributions }
  restrictedContributionsCount
  totalCommitContributions
  totalIssueContributions
  totalPullRequestContributions
  totalPullRequestReviewContributions
  totalRepositoryContributions
`;

// One aliased contributionsCollection per calendar year, in a single request.
// The API caps each collection at a one-year span.
function yearsQuery(years, now) {
  const collections = years.map((year) => {
    const from = `${year}-01-01T00:00:00Z`;
    const yearEnd = `${year}-12-31T23:59:59Z`;
    const to = year === now.getUTCFullYear() ? now.toISOString() : yearEnd;
    return `y${year}: contributionsCollection(from: "${from}", to: "${to}") { ${YEAR_FIELDS} }`;
  });
  return `query ($login: String!) { user(login: $login) { ${collections.join('\n')} } }`;
}

export async function fetchRaw({ token, login, now = new Date() }) {
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
  const years = yearList.map((year) => {
    const c = yearly.user[`y${year}`];
    return {
      year,
      calendarTotal: c.contributionCalendar.totalContributions,
      restricted: c.restrictedContributionsCount,
      commits: c.totalCommitContributions,
      issues: c.totalIssueContributions,
      pullRequests: c.totalPullRequestContributions,
      reviews: c.totalPullRequestReviewContributions,
      repositories: c.totalRepositoryContributions,
    };
  });

  const repos = [];
  let cursor = null;
  do {
    const page = await graphql(token, REPOS_QUERY, { login, cursor });
    const { nodes, pageInfo } = page.user.repositories;
    for (const repo of nodes) {
      repos.push({
        name: repo.name,
        languages: repo.languages.edges.map((edge) => ({ name: edge.node.name, size: edge.size })),
      });
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return {
    login,
    generatedAt: now.toISOString(),
    pastYear: {
      calendarTotal: pastYear.contributionCalendar.totalContributions,
      restricted: pastYear.restrictedContributionsCount,
    },
    years,
    repos,
  };
}
