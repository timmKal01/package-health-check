const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

async function fetchWithRetry(url, options = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            if (res.status === 404) return { status: 404 };
            const body = await res.json().catch(() => null);
            if (res.ok && body) return { status: res.status, body };
            const retryable = res.status === 429 || res.status >= 500 || body === null;
            lastErr = new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
            if (!retryable) throw lastErr;
        } catch (err) {
            lastErr = err.name === 'AbortError' ? new Error(`Request timed out (${url})`) : err;
        } finally {
            clearTimeout(timer);
        }
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
    throw lastErr;
}

function extractGithubUrlFromCandidates(candidates) {
    for (const c of candidates) {
        if (typeof c === 'string' && /github\.com/i.test(c)) return c;
    }
    return null;
}

async function fetchNpm(name) {
    const { status, body } = await fetchWithRetry(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        headers: { 'User-Agent': 'PackageHealthCheck/0.1', Accept: 'application/json' },
    });
    if (status === 404) return { found: false };

    const latest = body['dist-tags']?.latest ?? null;
    const versionInfo = latest ? body.versions?.[latest] : null;
    const license = versionInfo?.license;
    const repo = versionInfo?.repository;

    return {
        found: true,
        latestVersion: latest,
        publishedAt: latest ? (body.time?.[latest] ?? null) : null,
        license: typeof license === 'string' ? license : (license?.type ?? null),
        homepageUrl: versionInfo?.homepage ?? null,
        repositoryUrl: typeof repo === 'string' ? repo : (repo?.url ?? null),
        deprecatedOrYanked: typeof body.deprecated === 'string' || typeof versionInfo?.deprecated === 'string',
    };
}

async function fetchPypi(name) {
    const { status, body } = await fetchWithRetry(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (status === 404) return { found: false };

    const latest = body.info?.version ?? null;
    const releaseFiles = latest ? (body.releases?.[latest] ?? []) : [];
    const projectUrls = body.info?.project_urls ?? {};
    const githubUrl = extractGithubUrlFromCandidates([
        projectUrls.Source, projectUrls.Repository, projectUrls.GitHub, projectUrls.Homepage, body.info?.home_page,
    ]);

    return {
        found: true,
        latestVersion: latest,
        publishedAt: releaseFiles[0]?.upload_time_iso_8601 ?? null,
        license: body.info?.license || null,
        homepageUrl: body.info?.home_page ?? projectUrls.Homepage ?? null,
        repositoryUrl: githubUrl,
        deprecatedOrYanked: releaseFiles.length > 0 && releaseFiles.every((f) => f.yanked === true),
    };
}

async function fetchCrates(name) {
    const { status, body } = await fetchWithRetry(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
        headers: { 'User-Agent': 'PackageHealthCheck/0.1 (contact: package-health-check-admin@example.com)' },
    });
    if (status === 404) return { found: false };

    const newest = body.crate?.newest_version ?? null;
    const versionEntry = body.versions?.find((v) => v.num === newest) ?? body.versions?.[0];

    return {
        found: true,
        latestVersion: newest,
        publishedAt: body.crate?.updated_at ?? null,
        license: versionEntry?.license ?? null,
        homepageUrl: body.crate?.homepage ?? null,
        repositoryUrl: body.crate?.repository ?? null,
        deprecatedOrYanked: versionEntry?.yanked === true,
    };
}

async function fetchRubygems(name) {
    const { status, body } = await fetchWithRetry(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`);
    if (status === 404) return { found: false };

    return {
        found: true,
        latestVersion: body.version ?? null,
        publishedAt: body.version_created_at ?? null,
        license: Array.isArray(body.licenses) ? body.licenses[0] ?? null : null,
        homepageUrl: body.homepage_uri ?? null,
        repositoryUrl: body.source_code_uri ?? body.homepage_uri ?? null,
        deprecatedOrYanked: body.yanked === true,
    };
}

function comparePackagistVersions(a, b) {
    const parse = (v) => v.replace(/^v/, '').split(/[.\-+]/).map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : p));
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i];
        const y = pb[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        if (x === y) continue;
        if (typeof x === 'number' && typeof y === 'number') return x - y;
        return String(x).localeCompare(String(y));
    }
    return 0;
}

function findLatestStablePackagistVersion(versions) {
    const candidates = Object.entries(versions ?? {}).filter(([key, v]) => {
        if (/^dev-/.test(key)) return false;
        if (/-dev$/.test(key)) return false;
        if (/9999999/.test(v?.version_normalized ?? '')) return false;
        return true;
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => comparePackagistVersions(b[1].version_normalized, a[1].version_normalized));
    return candidates[0][1];
}

async function fetchPackagist(name) {
    const { status, body } = await fetchWithRetry(`https://packagist.org/packages/${name}.json`);
    if (status === 404) return { found: false };

    const p = body.package;
    const latest = findLatestStablePackagistVersion(p.versions);

    return {
        found: true,
        latestVersion: latest?.version ?? null,
        publishedAt: latest?.['published-time'] ?? latest?.time ?? null,
        license: Array.isArray(latest?.license) ? latest.license[0] ?? null : null,
        homepageUrl: latest?.homepage ?? null,
        repositoryUrl: p.repository ?? null,
        deprecatedOrYanked: false,
    };
}

async function fetchNuget(packageId) {
    const searchUrl = new URL('https://azuresearch-usnc.nuget.org/query');
    searchUrl.searchParams.set('q', `packageid:${packageId}`);
    searchUrl.searchParams.set('prerelease', 'false');
    searchUrl.searchParams.set('take', '5');

    const { body: searchBody } = await fetchWithRetry(searchUrl);
    const exact = searchBody?.data?.find((d) => d?.id?.toLowerCase() === packageId.toLowerCase());
    if (!exact) return { found: false };

    let publishedAt = null;
    const versionEntry = exact.versions?.find((v) => v.version === exact.version);
    if (versionEntry?.['@id']) {
        try {
            const { body: leaf } = await fetchWithRetry(versionEntry['@id']);
            publishedAt = leaf?.published ?? null;
        } catch {
            // Publish date is a nice-to-have second call; don't fail the whole lookup if it errors.
        }
    }

    return {
        found: true,
        latestVersion: exact.version ?? null,
        publishedAt,
        license: exact.licenseUrl ?? null,
        homepageUrl: exact.projectUrl ?? null,
        repositoryUrl: extractGithubUrlFromCandidates([exact.projectUrl]),
        deprecatedOrYanked: false,
    };
}

export const REGISTRY_FETCHERS = {
    npm: fetchNpm,
    pypi: fetchPypi,
    crates: fetchCrates,
    rubygems: fetchRubygems,
    packagist: fetchPackagist,
    nuget: fetchNuget,
};
