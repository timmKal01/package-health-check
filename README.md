# Package Health Check: Maintenance Status Across 6 Ecosystems

Give it a package name and its ecosystem. Get back its latest version,
license, linked GitHub repo signals (stars, open issues, last push), and a
computed maintenance status: `ACTIVE`, `STALE`, or `ABANDONED`. Works
across npm, PyPI, crates.io, RubyGems, Packagist, and NuGet with one
consistent output shape, so you're not juggling six different registry
formats to answer "is this thing safe to depend on."

## Who this is for

- **Engineering leads and AppSec teams** doing dependency review before adopting a new package, across any of the six ecosystems.
- **Due-diligence and vendor-risk reviewers** checking whether a vendor's stated tech stack relies on abandoned packages.
- **Open-source maintainers** auditing their own dependency tree for things that need replacing.

This is a maintenance-health check, not a vulnerability scanner: it tells
you whether a package is still being actively worked on, not whether it has
known CVEs.

## Input

| Field | Type | Description |
|---|---|---|
| `packages` | array | `[{ "ecosystem": "npm", "name": "express" }]`. Ecosystem must be one of `npm`, `pypi`, `crates`, `rubygems`, `packagist`, `nuget`. |
| `githubToken` | string (optional) | A personal access token to raise the GitHub API limit from 60 to 5,000 requests/hour when checking many packages with linked GitHub repos in one run. |

```json
{
  "packages": [
    { "ecosystem": "npm", "name": "express" },
    { "ecosystem": "pypi", "name": "requests" },
    { "ecosystem": "crates", "name": "serde" }
  ]
}
```

## Output

One record per package:

```json
{
  "ecosystem": "npm",
  "packageName": "express",
  "found": true,
  "latestVersion": "4.21.2",
  "publishedAt": "2025-12-01T10:00:00.000Z",
  "license": "MIT",
  "homepageUrl": "http://expressjs.com/",
  "repositoryUrl": "https://github.com/expressjs/express",
  "deprecatedOrYanked": false,
  "github": {
    "stars": 66000,
    "openIssues": 120,
    "pushedAt": "2026-08-01T12:00:00.000Z",
    "archived": false
  },
  "lastActivityAt": "2026-08-01T12:00:00.000Z",
  "maintenanceStatus": "ACTIVE",
  "checkedAt": "2026-09-19T12:00:00.000Z"
}
```

`maintenanceStatus` is computed from the more recent of the registry's last
publish date and the linked GitHub repo's last push date:

- **ACTIVE**: activity within the last 180 days
- **STALE**: last activity 180–730 days ago
- **ABANDONED**: over 730 days, or the package is deprecated/yanked, or its repo is archived
- **UNKNOWN**: no usable date found (rare; usually means no linked repo and the registry didn't report a publish date)

If a package isn't found in the registry, the record is `{ "found": false }`
and no GitHub lookup is attempted.

## How it works

Direct calls to each registry's own public API (npmjs.org, pypi.org,
crates.io, rubygems.org, packagist.org, nuget.org): no scraping, no proxy.
When a registry entry has a `repositoryUrl` pointing to GitHub, one
additional call to the public GitHub REST API adds stars/issues/last-push
signal.

**GitHub rate limit note:** unauthenticated GitHub API access is capped at
60 requests/hour per source IP: enough for small-to-medium batches. For
large batches, pass your own `githubToken` (a GitHub personal access token
with no special scopes needed) to raise that to 5,000/hour. Packages
without a detected GitHub repo URL skip this step entirely and aren't
affected by the limit.

## Related products

- [NPM Package Update Tracker](https://github.com/timmKal01/npm-package-tracker): version-by-version release history for npm, instead of a single current health snapshot
- [RubyGems Package Lookup](https://github.com/timmKal01/rubygems-package-lookup) / [NuGet Package Lookup](https://github.com/timmKal01/nuget-package-lookup) / [Packagist Package Lookup](https://github.com/timmKal01/packagist-package-lookup): full metadata for a single ecosystem, if you don't need the cross-ecosystem health rollup
