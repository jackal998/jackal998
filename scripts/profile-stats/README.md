# Profile receipt

A daily GitHub Actions job (`.github/workflows/profile-stats.yml`) prints the
profile README as a header and two receipts covering the past 12 months:

- **Activity**: GitHub contributions per week; contributions by type, public
  and private side by side; GitHub's public and private totals; streaks and
  busiest days from the contribution calendar; and the hours of day my
  commits were made (in `PROFILE.timeZone`).

  GitHub only reports private contributions as one anonymous number, even to
  the owner's own token, so the types are counted from the repositories the
  same way for both columns: commits from the commit lists the stack reads
  anyway, pull requests and issues opened, pull requests reviewed and
  repositories created from the search API. They count slightly differently
  from GitHub's totals, so they are not meant to add up to them.
- **Stack**: the languages of the lines I changed in my own commits, lines
  added and removed, and the kind of repository (organisation or mine,
  private or public) they were changed in - never a repository name.

Each is an SVG per theme in `profile/`; the README only references those files.

```sh
node --test scripts/profile-stats/test/*.test.mjs
node scripts/profile-stats/main.mjs --fixture scripts/profile-stats/test/fixture.json --out /tmp/receipt
```

## Private repositories

Without extra setup the language breakdown and the types only see public
repositories. To include private ones (personal and company), add a
repository secret named `READ_TOKEN`:

1. <https://github.com/settings/tokens/new> (Personal access tokens, classic).
2. Scope: `repo` only. Expiration: as long as the organisation allows.
3. After creating it, choose **Configure SSO** and authorise the company
   organisation if it uses SAML single sign-on.
4. Repository Settings, Secrets and variables, Actions, New repository secret:
   name `READ_TOKEN`. Never paste the token anywhere else.

## What keeps private data private

This repository, its git history and its Actions logs are public, and history
is permanent. So:

- The script only reads: GraphQL mutations are refused and REST calls are GET
  only, even though a classic `repo` token could write.
- The token is passed to the single step that needs it; no third-party actions
  run in the workflow, and `actions/checkout` is pinned to a commit.
- Only aggregates leave the script: language shares, line, commit and
  contribution counts, search result counts, and commit counts per hour of day. Repository names,
  the organisation name and commit SHAs are never logged, rendered or written,
  and errors from the read token omit response bodies.
- `guard.mjs` checks the log summary and every SVG for the names of every
  private repository and organisation seen during the run; a hit aborts before
  anything is written or committed.
- The workflow commits exactly the six generated SVGs (`header`, `activity`
  and `stack`, light and dark), and `.gitignore` keeps `.env` and key files out.
- If a token ever lands in a public commit anyway, GitHub secret scanning
  detects it; keep push protection enabled in the repository's security
  settings so such a push is blocked in the first place.
