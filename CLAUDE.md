# Open Pitmaster

An open, anonymous dataset of shared smoker cooks: a Cloudflare Worker that receives them (`worker/`), the record
format (`format/`), the nightly data build (`build/`, `.github/workflows/nightly.yml`) and the public averages page
(`worker/src/site.js`). The data in `data/` is written by the nightly build only: never edit it by hand.

## Public repository: privacy rules
- No names, places, coordinates, device IDs, hostnames, emails or credentials of the owner, their family or home.
  Made-up examples only (Morgan, Casey, Lakeview, Hillcrest). The privacy guard checks every PR.
- Commit as `Legal-Copy7045 <323378128+Legal-Copy7045@users.noreply.github.com>`.
- Any change to what is collected or published updates PRIVACY.md and `regression/claims.yaml` in the same PR.

## Run and test
- Worker: `cd worker && node --test test/*.test.js`. Build: `python3 -m pytest -q build`.
- Page in a browser: `node --test regression/page/page.test.mjs`.
- Before marking a PR ready: `python3 regression/run.py check`. Full regression: `/regression`; `/walkthrough`.
- Deploy (owner, by hand, from the release tag only): see README "Releases and deployment".

## Working rules (project standard 1.1.0, `.github/standard.yaml`)
- Draft PR first; ready only when `check` passes and VERSION + CHANGELOG.md are bumped; after ready, push only to fix CI.
  Merge your own PR when `ci-result` is green.
- `ci-result` is the only required check. `nightly.yml` is the product, not CI: leave it alone unless the task is it.
- Read summaries, not logs.
