# Contributing to SeqLens

Thanks for helping. This file is the rule set for changes to this repository: what a
change must include, what CI enforces, and how review works.

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE), and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

**Security problems are not issues.** Report them privately as described in
[SECURITY.md](SECURITY.md).

## Getting set up

Needs Node 20.19+ or 22.12+ (`.nvmrc` pins 22).

```bash
npm ci
npm run dev           # then open the printed URL and click "Try demo dataset"
```

Before pushing, run what CI runs:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Ground rules

### The privacy guarantee is not negotiable

1. **No network I/O after load.** No `fetch`, `XMLHttpRequest`, `WebSocket`,
   `sendBeacon`, remote `import()`, CDN asset, web font, analytics, telemetry, or error
   reporter. If a feature seems to need one, open an issue first — the answer is almost
   always "the user supplies it locally".
2. **`connect-src 'self'` stays in `public/_headers`.** CI fails the build if it is
   removed. Do not loosen any other directive without a security review in the PR.
3. **No backend.** The build output is a static bundle.

### Untrusted input

Every imported file is untrusted. Sequence identifiers and descriptions in particular are
arbitrary text from the user's file.

1. **React renders text, never HTML.** `dangerouslySetInnerHTML` and `innerHTML` are not
   used, and a PR that adds one is rejected.
2. **The HTML report escapes every interpolation** with `escapeXml`, including
   attribute values. The report carries its own CSP with `default-src 'none'` and must not
   contain a `<script>` tag.
3. **CSV exports go through `escapeCsvField`**, which quotes per RFC 4180 and neutralises
   spreadsheet formulas (`=`, `+`, `-`, `@`).
4. **Parsers stay streaming and bounded.** No regex that can backtrack catastrophically
   on a crafted header, and no step that holds a whole file in memory.

### Code

1. **`src/bio/` is pure.** It imports nothing from React, the DOM, or storage, so it runs in
   workers, in the report generator, and in tests unchanged.
2. **Expensive work runs in a Web Worker**, reports staged progress, and checks for
   cancellation at chunk boundaries.
3. **Tests come with the change.** Algorithms are checked against hand-derived values or an
   independent reference; a bug fix includes a test that fails without it.
4. **Honest numbers.** An estimate is labelled as an estimate (MinHash Jaccard), a
   heuristic as a heuristic (center-star MSA). Do not present approximate output as exact.
5. **Accessibility.** Every chart keeps a table-view twin and a CSV export.

## CI gates

A pull request merges only when every required check is green:

| Check | What it enforces |
|---|---|
| Lint, types, tests, build | `eslint`, `tsc -b`, `vitest`, `vite build`, and the CSP still blocks outbound connections |
| Secret scan (gitleaks) | no credentials anywhere in the git history |
| CodeQL | no high-severity static-analysis alerts |
| Dependency audit | `npm audit` on runtime dependencies (informational) |

## Branches, commits and pull requests

* `main` is protected: no direct pushes, no force-pushes, no deletion. All changes land
  through a pull request with green checks and resolved review threads, merged as a squash
  or rebase. Release tags `v*` cannot be moved or deleted.
* Those rules are versioned in [`.github/rulesets/`](.github/rulesets) and applied with
  `bash scripts/apply-github-settings.sh`.
* Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
* Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(alignment): …`, `fix(parsers): …`, `docs: …`.
* One concern per pull request. Fill in the template, including how you tested it.

## Test data

Use synthetic or public-domain sequences only. Never attach real clinical, patient, or
proprietary sequence data to an issue, a pull request, or a test.
