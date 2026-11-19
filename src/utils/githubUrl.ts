export type ParsedGitHubRepoResult =
  | {
      valid: true;
      owner: string;
      repo: string;
      fullName: string;
      canonicalUrl: string;
    }
  | {
      valid: false;
      error: string;
    };

const OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPO_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;

export function parseGitHubRepositoryUrl(rawInput: string): ParsedGitHubRepoResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, error: 'Paste a GitHub repository URL to connect.' };
  }

  // Handle git@github.com:owner/repo.git
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2].replace(/\.git$/i, '');
    return validateOwnerAndRepo(owner, repo);
  }

  let candidate = trimmed;
  if (/^(?:www\.)?github\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      valid: false,
      error: 'Enter a valid GitHub repository URL (for example, https://github.com/owner/repo).',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return {
      valid: false,
      error: 'Only github.com repository URLs are supported.',
    };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return {
      valid: false,
      error: 'Include both the GitHub owner and repository name (e.g., https://github.com/owner/repo).',
    };
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  return validateOwnerAndRepo(owner, repo);
}

function validateOwnerAndRepo(owner: string, repo: string): ParsedGitHubRepoResult {
  if (!OWNER_PATTERN.test(owner)) {
    return {
      valid: false,
      error: 'GitHub owner name in the URL is invalid.',
    };
  }

  if (!REPO_PATTERN.test(repo) || repo === '.' || repo === '..') {
    return {
      valid: false,
      error: 'GitHub repository name in the URL is invalid.',
    };
  }

  const fullName = `${owner}/${repo}`;
  return {
    valid: true,
    owner,
    repo,
    fullName,
    canonicalUrl: `https://github.com/${fullName}`,
  };
}
