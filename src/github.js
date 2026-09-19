const REQUEST_TIMEOUT_MS = 15_000;

/** Matches github.com/{owner}/{repo} out of a URL, tolerating git+https, .git suffix, trailing paths. */
function parseGithubRepo(url) {
    if (!url) return null;
    const match = url.match(/github\.com[/:]([^/]+)\/([^/#.]+)/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

export async function fetchGithubRepoStats(repositoryUrl, githubToken) {
    const parsed = parseGithubRepo(repositoryUrl);
    if (!parsed) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'PackageHealthCheck/0.1' };
        if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

        const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
            headers,
            signal: controller.signal,
        });
        if (!res.ok) return null; // Not found, private, renamed, or rate-limited — treat as "no GitHub signal", not a hard failure.

        const body = await res.json();
        return {
            stars: body.stargazers_count ?? null,
            openIssues: body.open_issues_count ?? null,
            pushedAt: body.pushed_at ?? null,
            archived: body.archived ?? false,
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}
