# Open Pitmaster

An open, anonymous dataset of real smoker cooks, and the small service that collects them, so that everyone's cook
predictions and AI advice can learn from more than their own grill.

- **Opt-in only.** Nothing is shared unless the owner turns sharing on, and they can remove everything they've shared.
- **Anonymous.** Only rounded numbers and "how was it?" tags: cut, weight, pit, stall, total time, outside temperature
  band, season, rating. Never dates, times, places, notes, photos or names, and nothing that links two cooks.
  Details: [PRIVACY.md](PRIVACY.md).
- **Open.** The data is CC0 (public domain): [`data/`](data/). The code is MIT.

The first client is the [Smoker controller for the Char-Griller Gravity 980](https://github.com/Legal-Copy7045/gravity-controller)
(Setup → Share cooks).

## The page

https://api.open-pitmaster.workers.dev/ in a browser shows the shared averages by cut, weight, pit and weather
(worker/src/site.js; it reads data/aggregates.json from this repository in your browser: no tracking, no cookies).

## What's here

| Path | What |
|---|---|
| [`data/`](data/) | `cooks.jsonl` / `cooks.csv` (every shared cook) and `aggregates.json` (typical times and outcomes per group of 5+ cooks), rebuilt nightly |
| [`format/`](format/) | The record format, with examples every part is tested against |
| [`worker/`](worker/) | The receiving service (a Cloudflare Worker at `https://api.open-pitmaster.workers.dev`) |
| [`build/`](build/) | The nightly build: adds released cooks, removes deleted ones, rebuilds the averages |

## The service

| Route | |
|---|---|
| `POST /v1/cooks` | `{record, key_hash}`: one cook (format below), plus the SHA-256 of a random deletion key the sender keeps. `"test": true` checks the path and stores nothing. |
| `DELETE /v1/cooks/<id>` | Header `X-Delete-Key`: removes that cook (and, at the next build, from the dataset). |
| `GET /v1/released` | A daily snapshot: the stored cooks (shuffled) and the ids deleted by their owners. It changes at most once a day, so it never shows when a cook arrived. |

It refuses any record that isn't exactly the format, and stores nothing about the sender (no IP address, no time
received, request logging off).

## Running it

- Tests: `cd worker && node --test test/*.test.js`, and `python3 -m pytest build`.
- Tests: also `node --test regression/page/page.test.mjs` (the page in a browser) and `python3 regression/run.py check`.

## Releases and deployment

`VERSION` and [`CHANGELOG.md`](CHANGELOG.md) change with every merge to `main`; a merged version bump is the release
(CI tags `v<VERSION>` and publishes the GitHub Release). The Worker is deployed by hand, only from a release tag:

```bash
git fetch --tags && git checkout v$(cat VERSION)     # the release, never an unreleased commit
cd worker && npx wrangler deploy                     # wrangler version: .github/upstreams.yaml
```

First time: create a KV namespace and put its id in `worker/wrangler.toml`. Keep `[observability] enabled = false`.
The nightly data build (`.github/workflows/nightly.yml`) publishes `data/` every day and needs no release.
