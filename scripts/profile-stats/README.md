# Profile receipt

A daily GitHub Actions job (`.github/workflows/profile-stats.yml`) prints the
profile README as a receipt covering the past 12 months: GitHub contributions
(public and private) and the languages of the lines I changed in my own
commits. The result is two SVGs in `profile/`; the README only references
those files.

```sh
node --test scripts/profile-stats/test/*.test.mjs
node scripts/profile-stats/main.mjs --fixture scripts/profile-stats/test/fixture.json --out /tmp/receipt
```

## Private repositories

Without extra setup the language breakdown only sees public repositories. To
include private ones (personal and company), add a repository secret named
`READ_TOKEN`:

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
- Only aggregates leave the script: language shares, line and commit counts.
  Repository names, the organisation name and commit SHAs are never logged,
  rendered or written, and errors from the read token omit response bodies.
- `guard.mjs` checks the log summary and both SVGs for the names of every
  private repository and organisation seen during the run; a hit aborts before
  anything is written or committed.
- The workflow commits exactly `profile/receipt-light.svg` and
  `profile/receipt-dark.svg`, and `.gitignore` keeps `.env` and key files out.
- If a token ever lands in a public commit anyway, GitHub secret scanning
  detects it; keep push protection enabled in the repository's security
  settings so such a push is blocked in the first place.
