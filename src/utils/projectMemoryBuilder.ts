import type {
  ActivityEvent,
  ActivitySummary,
  ProjectMemory,
  Repository,
} from '../types/models';
import { formatShortDate } from './dateUtils';

function dedupe(items: string[], limit = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
    if (out.length >= limit) break;
  }
  return out;
}

export function extractCodeAreas(changedFiles: string[], limit = 15): string[] {
  const counts = new Map<string, number>();
  for (const file of changedFiles) {
    const cleaned = file.trim().replace(/^\/+/, '');
    if (!cleaned) continue;
    const parts = cleaned.split('/');
    const area =
      parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([area, count]) => `${area} (${count} ${count === 1 ? 'file' : 'files'})`);
}

export interface SynthesizedMemoryPayload {
  projectOverview: string;
  objective: string;
  technologies: string[];
  modifiedCodeAreas: string[];
  recentChanges: string[];
  openIssues: string[];
  openPullRequests: string[];
  technicalDecisions: string[];
  knownBlockers: string[];
  suggestedNextSteps: string[];
  supportingEventIds: string[];
}

export function synthesizeProjectMemoryFromHistory(
  repository: Repository,
  events: ActivityEvent[],
  summaries: ActivitySummary[],
  existingMemory?: ProjectMemory | null
): SynthesizedMemoryPayload {
  const sortedEvents = [...events].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  );
  const sortedSummaries = [...summaries].sort(
    (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime()
  );

  const pushEvents = sortedEvents.filter((e) => e.eventType === 'push');
  const prEvents = sortedEvents.filter((e) => e.eventType === 'pull_request');
  const issueEvents = sortedEvents.filter((e) => e.eventType === 'issues');

  // Track latest state per PR number / issue number deterministically
  const latestPrByNumber = new Map<number, ActivityEvent>();
  for (const pr of prEvents) {
    if (pr.prNumber != null && !latestPrByNumber.has(pr.prNumber)) {
      latestPrByNumber.set(pr.prNumber, pr);
    }
  }
  const openPullRequests = Array.from(latestPrByNumber.values())
    .filter((pr) => pr.prState === 'open')
    .map((pr) => `#${pr.prNumber}: ${pr.title.replace(/^\[PR #\d+ [^\]]+\]\s*/, '')} (${pr.branch})`);

  const latestIssueByNumber = new Map<number, ActivityEvent>();
  for (const issue of issueEvents) {
    if (issue.issueNumber != null && !latestIssueByNumber.has(issue.issueNumber)) {
      latestIssueByNumber.set(issue.issueNumber, issue);
    }
  }
  const openIssues = Array.from(latestIssueByNumber.values())
    .filter((iss) => iss.issueState === 'open')
    .map((iss) => `#${iss.issueNumber}: ${iss.title.replace(/^\[Issue #\d+ [^\]]+\]\s*/, '')}`);

  const recentChanges = dedupe(
    pushEvents.slice(0, 15).map((ev) => {
      const sha = ev.commitSha ? ev.commitSha.slice(0, 7) : 'commit';
      return `[${ev.branch || repository.defaultBranch}] ${ev.title} (${sha})`;
    }),
    20
  );

  const allChangedFiles = sortedEvents.slice(0, 30).flatMap((e) => e.changedFiles);
  const modifiedCodeAreas = extractCodeAreas(allChangedFiles, 15);

  const technologies = dedupe(
    [
      ...(repository.primaryLanguage ? [repository.primaryLanguage] : []),
      ...(existingMemory?.technologies ?? []),
    ],
    20
  );

  // Known blockers must ONLY come from verified evidence (e.g. open issues explicitly tagged/titled blocker or failed CI/checks if recorded, never fabricated)
  const evidenceBlockers = Array.from(latestIssueByNumber.values())
    .filter(
      (iss) =>
        iss.issueState === 'open' &&
        /\b(blocker|blocked|urgent|regression|outage|broken)\b/i.test(
          `${iss.title} ${iss.description}`
        )
    )
    .map(
      (iss) =>
        `Issue #${iss.issueNumber}: ${iss.title.replace(/^\[Issue #\d+ [^\]]+\]\s*/, '')}`
    );

  // Preserve any evidence-backed technical decisions or keep empty when none recorded
  const technicalDecisions = dedupe(existingMemory?.technicalDecisions ?? [], 25);

  // Suggested next steps come from AI summaries if available, plus open PRs/issues
  const aiSuggestions = sortedSummaries
    .slice(0, 5)
    .flatMap((s) => s.suggestedNextSteps);
  const deterministicNextSteps = [
    ...openPullRequests.slice(0, 3).map((pr) => `Review open pull request ${pr}`),
    ...openIssues.slice(0, 3).map((iss) => `Triage open issue ${iss}`),
  ];
  const suggestedNextSteps = dedupe([...aiSuggestions, ...deterministicNextSteps], 12);

  const latestSummaryText = sortedSummaries[0]?.summary?.trim();
  const projectOverview =
    latestSummaryText ||
    repository.description.trim() ||
    (sortedEvents.length > 0
      ? `Tracked ${sortedEvents.length} repository activity events on ${repository.fullName} (default branch: ${repository.defaultBranch}).`
      : `Connected repository ${repository.fullName}. Waiting for incoming GitHub activity events.`);

  return {
    projectOverview: projectOverview.slice(0, 3000),
    objective: (repository.objective ?? existingMemory?.objective ?? '').trim().slice(0, 1000),
    technologies,
    modifiedCodeAreas,
    recentChanges,
    openIssues: openIssues.slice(0, 30),
    openPullRequests: openPullRequests.slice(0, 30),
    technicalDecisions,
    knownBlockers: dedupe(evidenceBlockers, 20),
    suggestedNextSteps,
    supportingEventIds: sortedEvents.slice(0, 50).map((e) => e.id),
  };
}

export interface ResumeMarkdownReport {
  markdown: string;
  hasInsufficientHistory: boolean;
  relevantLinks: string[];
}

export function buildAutomatedResumeMarkdown(
  repository: Repository,
  memory: SynthesizedMemoryPayload,
  events: ActivityEvent[],
  summaries: ActivitySummary[],
  generatedAt: Date = new Date()
): ResumeMarkdownReport {
  const sortedEvents = [...events].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  );
  const relevantLinks = dedupe(
    [
      ...(repository.htmlUrl ? [repository.htmlUrl] : []),
      ...sortedEvents.slice(0, 10).map((e) => e.sourceUrl),
    ],
    12
  );

  const hasInsufficientHistory = sortedEvents.length === 0;

  const lines: string[] = [];
  lines.push(`# Resume Project Context: ${repository.fullName}`);
  lines.push('');
  lines.push(
    `> Generated by BuildLog on ${formatShortDate(generatedAt)} from automated GitHub repository activity.`
  );
  lines.push('');

  if (hasInsufficientHistory) {
    lines.push(
      '**Notice — Minimal Activity History:** No GitHub push, pull request, or issue events have been ingested for this repository yet. Sync repository history or trigger a webhook event to enrich this brief.'
    );
    lines.push('');
  }

  lines.push('## 1. Repository & Project Objective');
  lines.push(`- **Repository:** ${repository.fullName}`);
  lines.push(`- **Default Branch:** ${repository.defaultBranch}`);
  lines.push(`- **Status:** ${repository.status}`);
  lines.push(`- **Objective:** ${memory.objective || 'Not supplied yet.'}`);
  lines.push(`- **Overview:** ${memory.projectOverview}`);
  lines.push('');

  lines.push('## 2. Technology Information');
  if (memory.technologies.length > 0) {
    lines.push(memory.technologies.map((t) => `- ${t}`).join('\n'));
  } else {
    lines.push(`- Primary language: ${repository.primaryLanguage || 'Not detected yet.'}`);
  }
  lines.push('');

  lines.push('## 3. Recent Commits & Changes (Verified GitHub Facts)');
  if (memory.recentChanges.length > 0) {
    lines.push(memory.recentChanges.map((c) => `- ${c}`).join('\n'));
  } else {
    lines.push('- No recent commits recorded yet.');
  }
  lines.push('');

  lines.push('## 4. Modified Code Areas');
  if (memory.modifiedCodeAreas.length > 0) {
    lines.push(memory.modifiedCodeAreas.map((area) => `- ${area}`).join('\n'));
  } else {
    lines.push('- No changed file path metadata recorded yet.');
  }
  lines.push('');

  lines.push('## 5. Open Issues');
  if (memory.openIssues.length > 0) {
    lines.push(memory.openIssues.map((iss) => `- ${iss}`).join('\n'));
  } else {
    lines.push('- No open issues tracked from ingested events.');
  }
  lines.push('');

  lines.push('## 6. Open Pull Requests');
  if (memory.openPullRequests.length > 0) {
    lines.push(memory.openPullRequests.map((pr) => `- ${pr}`).join('\n'));
  } else {
    lines.push('- No open pull requests tracked from ingested events.');
  }
  lines.push('');

  lines.push('## 7. Known Blockers (Evidence-Backed Only)');
  if (memory.knownBlockers.length > 0) {
    lines.push(memory.knownBlockers.map((b) => `- ${b}`).join('\n'));
  } else {
    lines.push('- No blockers supported by current GitHub issue/PR evidence.');
  }
  lines.push('');

  if (summaries.length > 0) {
    lines.push('## 8. Recent Automated Activity Summaries');
    for (const s of summaries.slice(0, 3)) {
      lines.push(`### ${formatShortDate(s.generatedAt)}`);
      lines.push(`- **Summary:** ${s.summary}`);
      if (s.evidence.length > 0) {
        lines.push(`- **Verified Evidence:** ${s.evidence.join('; ')}`);
      }
      if (s.inferences.length > 0) {
        lines.push(`- **Metadata Inferences:** ${s.inferences.join('; ')}`);
      }
      lines.push('');
    }
  }

  lines.push('## 9. Suggested Next Actions');
  if (memory.suggestedNextSteps.length > 0) {
    lines.push(memory.suggestedNextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n'));
  } else {
    lines.push('1. Sync recent repository history or push commits to generate next-step checks.');
  }
  lines.push('');

  lines.push('## 10. Relevant GitHub Links');
  if (relevantLinks.length > 0) {
    lines.push(relevantLinks.map((url) => `- ${url}`).join('\n'));
  } else {
    lines.push('- No GitHub links recorded yet.');
  }
  lines.push('');

  return {
    markdown: lines.join('\n'),
    hasInsufficientHistory,
    relevantLinks,
  };
}
