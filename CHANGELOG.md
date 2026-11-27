# Changelog

Newest first ([Keep a Changelog](https://keepachangelog.com/)); `VERSION` holds the current version and a merged
version bump is the release (tag `v<VERSION>` and a GitHub Release).

## [1.0.0] - 2026-11-27

The first numbered release: the receiving Worker, the record format, the nightly data build and the public averages
page as they stand, now under the owner's project standard.

### Added
- One CI workflow (`ci.yml`, replacing `tests.yml`): nothing on drafts or working branches; on ready pull requests the
  version, privacy and secret checks and the worker and build tests, plus the page in a browser when the page or the
  format changed; on `main` only the private-terms check and the release; a full run every Sunday. `ci-result` is the
  one required check.
- Releases: `VERSION`, this changelog, tag `v<VERSION>` and a GitHub Release from the release path; the Worker is
  deployed by hand from the release tag (README).
- Weekly CodeQL, weekly grouped Dependabot updates (GitHub Actions, `worker/`) that merge themselves when CI passes,
  `.github/upstreams.yaml` (wrangler, the Workers compatibility date, Playwright).
- `regression/`: ci, unit, page (the averages page from a made-up `aggregates.json`, desktop and phone), live
  (read-only), manual, and a one-role walkthrough of the public page; `claims.yaml` from PRIVACY.md.
- `CLAUDE.md`: how to run and test the project, and the public-repository rules.

### Changed
- `worker/package.json` carries the version.
