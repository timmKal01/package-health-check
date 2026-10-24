import { Actor, log } from 'apify';
import { REGISTRY_FETCHERS } from './registries.js';
import { fetchGithubRepoStats } from './github.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { packages: packagesInput, githubToken } = input;

/** Must match the event name configured in this Actor's pay-per-event pricing on Apify. */
const PACKAGE_CHECKED_EVENT = 'package-checked';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_THRESHOLD_DAYS = 180;
const STALE_THRESHOLD_DAYS = 730;

function computeMaintenanceStatus({ deprecatedOrYanked, github, lastActivityAt }) {
    if (deprecatedOrYanked || github?.archived) return 'ABANDONED';
    if (!lastActivityAt) return 'UNKNOWN';
    const daysSince = (Date.now() - new Date(lastActivityAt).getTime()) / DAY_MS;
    if (daysSince <= ACTIVE_THRESHOLD_DAYS) return 'ACTIVE';
    if (daysSince <= STALE_THRESHOLD_DAYS) return 'STALE';
    return 'ABANDONED';
}

if (packagesInput !== undefined && packagesInput !== null && !Array.isArray(packagesInput)) {
    throw new Error('Input "packages" must be an array of { "ecosystem": "npm", "name": "..." } objects.');
}
// An empty call (an AI agent calling with {}, or an empty API call) checks the input form's example instead of failing.
const EXAMPLE_PACKAGES = [{ ecosystem: 'npm', name: 'express' }];
const packages = packagesInput?.length ? packagesInput : EXAMPLE_PACKAGES;
if (packages === EXAMPLE_PACKAGES) log.info('No packages given, so checking the example: npm express.');

for (const pkg of packages) {
    const ecosystem = pkg?.ecosystem;
    const name = pkg?.name;
    const fetcher = REGISTRY_FETCHERS[ecosystem];

    if (!fetcher || !name) {
        log.warning('Skipping invalid package entry: need { ecosystem, name } with a supported ecosystem', {
            pkg,
            supportedEcosystems: Object.keys(REGISTRY_FETCHERS),
        });
        continue;
    }

    log.info(`Checking ${ecosystem}:${name}`);

    let registryData;
    try {
        registryData = await fetcher(name);
    } catch (err) {
        log.warning(`Registry lookup failed for ${ecosystem}:${name}`, { error: err.message });
        await Actor.pushData({
            ecosystem, packageName: name, found: false, error: err.message, checkedAt: new Date().toISOString(),
        });
        continue;
    }

    if (!registryData.found) {
        await Actor.pushData({ ecosystem, packageName: name, found: false, checkedAt: new Date().toISOString() });
        continue;
    }

    const github = registryData.repositoryUrl
        ? await fetchGithubRepoStats(registryData.repositoryUrl, githubToken)
        : null;

    const lastActivityAt = [registryData.publishedAt, github?.pushedAt]
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0] ?? null;

    const maintenanceStatus = computeMaintenanceStatus({
        deprecatedOrYanked: registryData.deprecatedOrYanked,
        github,
        lastActivityAt,
    });

    await Actor.pushData({
        ecosystem,
        packageName: name,
        found: true,
        latestVersion: registryData.latestVersion,
        publishedAt: registryData.publishedAt,
        license: registryData.license,
        homepageUrl: registryData.homepageUrl,
        repositoryUrl: registryData.repositoryUrl,
        deprecatedOrYanked: registryData.deprecatedOrYanked,
        github,
        lastActivityAt,
        maintenanceStatus,
        checkedAt: new Date().toISOString(),
    });

    await Actor.charge({ eventName: PACKAGE_CHECKED_EVENT });
}

log.info(`Checked ${packages.length} package(s)`);

await Actor.exit();
