import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitPullRequest,
  Plug,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { WebhookHealthCard } from '../components/integrations/WebhookHealthCard';
import { Button, getButtonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import {
  EventTypeLabel,
  ProcessingStatusLabel,
  RepositoryStatusLabel,
} from '../components/ui/StatusLabel';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { computeDashboardMetrics } from '../utils/dashboardStats';
import { formatRelativeDate, formatShortDate } from '../utils/dateUtils';
import {
  buildAutomatedResumeMarkdown,
  synthesizeProjectMemoryFromHistory,
} from '../utils/projectMemoryBuilder';

export function DashboardPage() {
  const { user, userProfile } = useAuth();
  const {
    integrations,
    repositories,
    activityEvents,
    activitySummaries,
    projectMemory,
    loading,
    error,
  } = useWorkspace();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [copiedRepoId, setCopiedRepoId] = useState<string | null>(null);

  const metrics = useMemo(
    () =>
      computeDashboardMetrics(
        repositories,
        activityEvents,
        activitySummaries,
        projectMemory
      ),
    [repositories, activityEvents, activitySummaries, projectMemory]
  );

  const maxDailyTotal = Math.max(
    1,
    ...metrics.weeklyActivity.map((d) => d.totalCount)
  );

  const displayName =
    userProfile?.displayName ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'Developer';

  const connectedIntegrationCount = integrations.filter(
    (i) => i.status === 'connected'
  ).length;

  const repoMap = useMemo(
    () => new Map(repositories.map((r) => [r.id, r])),
    [repositories]
  );

  const handleCopyRepoContext = async (repositoryId: string) => {
    const repo = repoMap.get(repositoryId);
    if (!repo) return;
    const repoEvents = activityEvents.filter((e) => e.repositoryId === repo.id);
    const repoSummaries = activitySummaries.filter((s) => s.repositoryId === repo.id);
    const existing = projectMemory.find((m) => m.repositoryId === repo.id) ?? null;
    const synthesized = synthesizeProjectMemoryFromHistory(
      repo,
      repoEvents,
      repoSummaries,
      existing
    );
    const report = buildAutomatedResumeMarkdown(
      repo,
      synthesized,
      repoEvents,
      repoSummaries,
      existing?.lastUpdatedAt ?? new Date()
    );

    try {
      await navigator.clipboard.writeText(report.markdown);
      setCopiedRepoId(repo.id);
      showToast(`Copied Resume Context for ${repo.fullName}.`, 'success');
      window.setTimeout(() => setCopiedRepoId(null), 2000);
    } catch {
      showToast('Clipboard access was denied in this browser.', 'error');
    }
  };

  return (
    <AppShell
      title="Overview"
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Overview' }]}
      subtitle="Automated GitHub activity overview, inferred activity clusters, and live project memory."
      actions={
        <>
          <Link to="/memory" className={getButtonClasses('secondary', 'sm')}>
            <FileCode2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Project Memory</span>
          </Link>
          <Link to="/integrations" className={getButtonClasses('primary', 'sm')}>
            <Plug className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Connect Repository</span>
          </Link>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <div className="h-32 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse"
              />
            ))}
          </div>
        </div>
      ) : repositories.length === 0 ? (
        <div className="space-y-6">
          <WebhookHealthCard variant="dashboard" />
          <EmptyState
            icon={<Plug className="w-5 h-5" />}
            title="Connect a GitHub repository to start automated memory"
            description="Paste any GitHub repository URL to authorize read-only access, import recent commits, pull requests, and issues, and track new changes automatically."
            actionLabel="Connect Repository"
            onAction={() => navigate('/integrations')}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Welcome Telemetry Banner */}
          <section className="relative overflow-hidden rounded-2xl border border-[#252D24] bg-[#121512] p-6">
            <div
              className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#B8F34A]/[0.07] blur-[90px]"
              aria-hidden="true"
            />
            <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-1.5">
                <p className="text-xs font-mono text-[#B8F34A]">
                  Welcome back, {displayName}
                </p>
                <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#FCFFEC]">
                  {metrics.activeReposCount} active{' '}
                  {metrics.activeReposCount === 1 ? 'repository' : 'repositories'} tracked on autopilot
                </h2>
                <p className="text-sm text-[#929B90]">
                  {metrics.totalEventsCount} GitHub events recorded across{' '}
                  {connectedIntegrationCount} connected{' '}
                  {connectedIntegrationCount === 1 ? 'installation' : 'installations'}.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <Link to="/projects" className={getButtonClasses('secondary', 'md')}>
                  <GitBranch className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Browse Projects</span>
                </Link>
                <Link to="/memory" className={getButtonClasses('primary', 'md')}>
                  <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Resume Context</span>
                </Link>
              </div>
            </div>
          </section>

          {/* Real-Time Webhook Connectivity Health & Last Synced */}
          <WebhookHealthCard variant="dashboard" />

          {/* 4-Card Metric Quad */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Active Repositories</span>
                <GitBranch className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.activeReposCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90]">
                {repositories.length} total connected
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Events This Week</span>
                <Activity className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.eventsThisWeekCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90] tabular-nums">
                {metrics.totalEventsCount} total ingested events
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>AI Summaries Ready</span>
                <Sparkles className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.aiSummariesCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90] tabular-nums">
                {metrics.pendingEventsCount} awaiting summary
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Open PRs &amp; Issues</span>
                <GitPullRequest className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.openPullRequestsCount + metrics.openIssuesCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90] tabular-nums">
                {metrics.openPullRequestsCount} PRs · {metrics.openIssuesCount} issues
              </p>
            </div>
          </section>

          {/* Main Asymmetric 8/4 Workspace Grid */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 8 Columns: Summaries, Inferred Clusters, and Events */}
            <div className="lg:col-span-8 space-y-6">
              {/* Recent Activity Summaries */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                      Recent Activity Summaries
                    </h2>
                    <p className="mt-0.5 text-xs text-[#929B90]">
                      Evidence-backed repository briefs ready to copy into your next coding session.
                    </p>
                  </div>
                  <Link
                    to="/memory"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    Open Memory
                  </Link>
                </div>

                {activitySummaries.length === 0 ? (
                  <div className="rounded-xl border border-[#252D24] bg-[#080908] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-[#929B90] leading-relaxed">
                      No AI summaries generated yet. Raw GitHub events are preserved—open a repository or the Timeline to summarize pending events.
                    </p>
                    <Link to="/timeline" className={getButtonClasses('secondary', 'sm')}>
                      Review Timeline
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activitySummaries.slice(0, 3).map((summary) => {
                      const repo = repoMap.get(summary.repositoryId);
                      const isCopied = copiedRepoId === summary.repositoryId;
                      return (
                        <article
                          key={summary.id}
                          className="rounded-xl border border-[#252D24] bg-[#080908] p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Sparkles className="w-3.5 h-3.5 text-[#B8F34A] shrink-0" aria-hidden="true" />
                              <Link
                                to={repo ? `/projects/${repo.id}` : '/projects'}
                                className="text-sm font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A] truncate"
                              >
                                {repo?.fullName ?? 'Repository'}
                              </Link>
                            </div>
                            <span className="text-xs font-mono tabular-nums text-[#929B90] shrink-0">
                              {formatShortDate(summary.generatedAt)}
                            </span>
                          </div>

                          <p className="text-sm text-[#F3F5EF]/90 leading-relaxed">
                            {summary.summary}
                          </p>

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#252D24]">
                            <span className="text-xs font-mono text-[#929B90] tabular-nums">
                              {summary.evidence.length} verified facts ·{' '}
                              {summary.suggestedNextSteps.length} suggested next checks
                            </span>

                            {repo && (
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon={
                                    isCopied ? (
                                      <Check className="w-3.5 h-3.5 text-[#B8F34A]" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )
                                  }
                                  onClick={() => void handleCopyRepoContext(repo.id)}
                                >
                                  {isCopied ? 'Copied' : 'Copy Context'}
                                </Button>
                                <Link
                                  to={`/projects/${repo.id}/memory`}
                                  className={getButtonClasses('ghost', 'sm')}
                                >
                                  <span>Memory</span>
                                  <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                </Link>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Inferred Activity Clusters */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                      Inferred Activity Clusters
                    </h2>
                    <p className="mt-0.5 text-xs text-[#929B90]">
                      Grouped automatically from events within 90 minutes. Inferred patterns—not verified hours worked.
                    </p>
                  </div>
                  <Link
                    to="/timeline"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    Open timeline
                  </Link>
                </div>

                {metrics.recentClusters.length === 0 ? (
                  <p className="mt-5 text-sm text-[#929B90]">
                    No GitHub events ingested yet. Sync a repository from Projects to build activity clusters.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-[#252D24]">
                    {metrics.recentClusters.map((cluster) => (
                      <li key={cluster.clusterId} className="py-3.5 first:pt-0 last:pb-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              to={`/projects/${cluster.repositoryId}`}
                              className="text-sm font-medium text-[#FCFFEC] hover:text-[#B8F34A] transition-colors truncate block"
                            >
                              {cluster.repositoryName} — {cluster.label}
                            </Link>
                            <p className="mt-0.5 text-xs text-[#929B90] font-mono truncate">
                              {cluster.branches.join(', ') || 'default'} ·{' '}
                              {cluster.changedFiles.length} changed files recorded
                            </p>
                          </div>
                          <span className="text-xs font-mono tabular-nums text-[#929B90] whitespace-nowrap shrink-0">
                            {formatRelativeDate(cluster.endAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recent GitHub Events Stream */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Recent GitHub Events
                  </h2>
                  <Link
                    to="/timeline"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    Full timeline
                  </Link>
                </div>

                {metrics.recentEvents.length === 0 ? (
                  <p className="mt-4 text-sm text-[#929B90]">
                    Waiting for your first GitHub push, pull request, or issue event.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-[#252D24]">
                    {metrics.recentEvents.map((ev) => (
                      <li key={ev.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <EventTypeLabel eventType={ev.eventType} />
                            <span className="text-xs font-mono text-[#929B90] truncate">
                              {ev.repositoryName}
                            </span>
                          </div>
                          <ProcessingStatusLabel status={ev.processingStatus} />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-[#FCFFEC] truncate">{ev.title}</p>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="text-xs font-mono text-[#929B90] tabular-nums">
                              {formatRelativeDate(ev.occurredAt)}
                            </span>
                            {ev.sourceUrl && (
                              <a
                                href={ev.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open event on GitHub: ${ev.title}`}
                                className="text-[#929B90] hover:text-[#B8F34A]"
                              >
                                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Right 4 Columns: 7-Day Activity Pulse + Active Projects */}
            <div className="lg:col-span-4 space-y-6">
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 flex flex-col justify-between">
                <div>
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    7-Day Activity Pulse
                  </h2>
                  <p className="mt-0.5 text-xs text-[#929B90]">
                    Verified push, PR, and issue events ingested per day.
                  </p>
                </div>

                <div className="mt-6 grid grid-cols-7 gap-2 items-end h-36">
                  {metrics.weeklyActivity.map((day) => {
                    const pct = Math.round((day.totalCount / maxDailyTotal) * 100);
                    return (
                      <div
                        key={day.dateKey}
                        className="flex flex-col items-center justify-end h-full gap-1.5"
                      >
                        <span className="text-[11px] font-mono tabular-nums text-[#929B90]">
                          {day.totalCount}
                        </span>
                        <div className="w-full max-w-[26px] h-24 rounded-md bg-[#080908] border border-[#252D24] flex items-end overflow-hidden">
                          <div
                            className="w-full bg-[#B8F34A] transition-all duration-200"
                            style={{ height: `${day.totalCount > 0 ? Math.max(12, pct) : 0}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-[#929B90]">{day.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Active Projects
                  </h2>
                  <Link
                    to="/projects"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    View all
                  </Link>
                </div>

                <ul className="space-y-2.5">
                  {repositories.slice(0, 6).map((repo) => (
                    <li
                      key={repo.id}
                      className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={`/projects/${repo.id}`}
                          className="text-sm font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A] truncate block min-w-0"
                        >
                          {repo.fullName}
                        </Link>
                        <RepositoryStatusLabel status={repo.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-[#929B90]">
                        <span className="truncate font-mono">
                          {repo.primaryLanguage || 'Repo'} · {repo.defaultBranch}
                        </span>
                        <Link
                          to={`/projects/${repo.id}/memory`}
                          className="text-[#B8F34A] hover:underline whitespace-nowrap shrink-0 font-medium"
                        >
                          Memory →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
