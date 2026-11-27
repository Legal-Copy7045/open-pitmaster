# Regression

The project standard's regression (github.com/Legal-Copy7045/project-standards, STANDARD.md section 3); the global
`/regression`, `/walkthrough` and `/full-check` skills drive it from `profile.yaml`.

| Stage | What |
|---|---|
| `ci` | versions, privacy guard, bandit (build), gitleaks (when installed) |
| `unit` | worker tests (`node --test`) and the nightly build's pytest |
| `page` | the public page in Chromium, desktop and phone, from the made-up `page/aggregates.fixture.json` |
| `live` | read-only GETs of the public page, `data/` and `/v1/released`; skipped when the hosts aren't reachable |
| `manual` | `manual.yaml` |
| `walkthrough` | `walkthrough.mjs`: one role (visitor), every view of the page on desktop and phone |

`python3 regression/run.py check` (ci + unit) before a PR is marked ready. Playwright: preinstalled in Claude
sessions; elsewhere `npm install --no-save --prefix regression/page playwright@<version in .github/upstreams.yaml>`.
