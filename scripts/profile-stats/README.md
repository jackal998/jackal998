# Profile receipts and the weekly report

One generator, two views of the same data (past 12 months):

- **Public view**, in this public repository: a daily GitHub Actions job
  (`.github/workflows/profile-stats.yml`) prints the profile README as a
  résumé. A header, then two receipts:
  - **Activity**: GitHub contributions per week, public, private and in
    total, active days and the longest streak.
  - **Stack**: the languages of the lines I changed in my own commits, as
    shares, and the main languages at work and on side projects.

  Each is an SVG per theme in `profile/`; the README only references those
  files.
- **Report view**, in a private repository only: a weekly job
  (`private-report.yml`) writes everything the data holds - the week against
  the one before, contributions by type for public and private work, streaks,
  busiest days, commit hours, line counts, and the numbers per kind of
  repository - and opens an issue with it.

`fetch.mjs` and `aggregate.mjs` collect every detail. `views.mjs` decides
what the public view gets, so the public receipts can only print, and the
public logs only mention, what it hands over. Keep new details out of it
unless they belong on a résumé.

GitHub only reports private contributions as one anonymous number, even to
the owner's own token, so the report counts types from the repositories, the
same way for both columns. Commits come from the commit lists the stack reads
anyway. Pull requests and issues opened, pull requests reviewed and
repositories created come from the search API. They count slightly
differently from GitHub's totals, so they are not meant to add up to them.

```sh
node --test scripts/profile-stats/test/*.test.mjs
node scripts/profile-stats/main.mjs --fixture scripts/profile-stats/test/fixture.json --out /tmp/receipt
node scripts/profile-stats/main.mjs --view report --fixture scripts/profile-stats/test/fixture.json --out /tmp/report
```

## The weekly report

1. Create a **private** repository, for example `profile-report`.
2. Copy `private-report.yml` to `.github/workflows/weekly-report.yml` there.
3. Add the same `READ_TOKEN` secret to it (below).

It runs on Mondays, or by hand from the Actions tab; the `ref` input picks
the generator branch to run. Each report is kept in `reports/<date>/` with the
full receipts, and an issue assigned to the owner carries the text.

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
- Only aggregates leave the script, and the public view only the résumé
  ones: contribution totals, active days and streaks, language shares and main
  languages. Line, commit and repository counts, contributions by type, search
  counts and commit hours only go to the private report. Repository names,
  the organisation name and commit SHAs are never logged, rendered or written,
  and errors from the read token omit response bodies.
- `guard.mjs` checks the log summary and every file written, in both views,
  for the names of every private repository and organisation seen during the
  run; a hit aborts before anything is written or committed.
- The workflow commits exactly the six generated SVGs (`header`, `activity`
  and `stack`, light and dark), and `.gitignore` keeps `.env` and key files out.
- If a token ever lands in a public commit anyway, GitHub secret scanning
  detects it; keep push protection enabled in the repository's security
  settings so such a push is blocked in the first place.
