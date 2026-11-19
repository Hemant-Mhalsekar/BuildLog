export const SCHEMA_LIMITS = {
  DISPLAY_NAME_MAX: 80,
  INSTALLATION_ID_MAX: 64,
  ACCOUNT_NAME_MAX: 120,
  REPO_FULL_NAME_MAX: 200,
  REPO_DESC_MAX: 1000,
  REPO_OBJECTIVE_MAX: 1000,
  EVENT_TITLE_MAX: 300,
  EVENT_DESC_MAX: 5000,
  EVENT_FILES_MAX: 100,
  SUMMARY_TEXT_MAX: 3000,
  MEMORY_LIST_MAX: 50,
  RETENTION_MIN_DAYS: 7,
  RETENTION_MAX_DAYS: 3650,
} as const;

export function sanitizeStringList(
  items: string[],
  maxItems: number,
  maxItemLength = 300
): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of items) {
    const trimmed = String(raw).trim().slice(0, maxItemLength);
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Display name is required.';
  if (trimmed.length > SCHEMA_LIMITS.DISPLAY_NAME_MAX) {
    return `Display name must be ${SCHEMA_LIMITS.DISPLAY_NAME_MAX} characters or fewer.`;
  }
  return null;
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Email address is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'Enter a valid email address.';
  }
  return null;
}

export function validateInstallationId(installationId: string): string | null {
  const trimmed = installationId.trim();
  if (!trimmed) return 'GitHub installation ID is required.';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) {
    return 'Installation ID must be alphanumeric (e.g., 12345678).';
  }
  return null;
}

export function validateObjective(objective: string): string | null {
  if (objective.trim().length > SCHEMA_LIMITS.REPO_OBJECTIVE_MAX) {
    return `Objective must be ${SCHEMA_LIMITS.REPO_OBJECTIVE_MAX} characters or fewer.`;
  }
  return null;
}
