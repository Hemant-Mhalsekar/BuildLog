import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Button, getButtonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Textarea } from '../components/ui/FormFields';
import {
  EventTypeLabel,
  ProcessingStatusLabel,
  RepositoryStatusLabel,
} from '../components/ui/StatusLabel';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { updateRepositoryObjective, updateRepositoryStatus } from '../services/dbService';
import { parseFriendlyFirestoreError } from '../lib/firebase';
import { formatRelativeDate, formatShortDate } from '../utils/dateUtils';
import { validateObjective, SCHEMA_LIMITS } from '../utils/validation';
import { synthesizeProjectMemoryFromHistory } from '../utils/projectMemoryBuilder';

export function RepositoryDetailPage() {
  const { repositoryId } = useParams<{ repositoryId: string }>();
  const navigate = useNavigate();
  const {
    repositories,
    activityEvents,
    activitySummaries,
    projectMemory,
    loading,
    syncingRepoId,
    summarizingRepoId,
    syncRepositoryHistory,
    summarizeRepositoryPendingEvents,
    refreshProjectMemory,
  } = useWorkspace();
  const { showToast } = useToast();

  const repository = useMemo(
    () => repositories.find((r) => r.id === repositoryId) ?? null,
    [repositories, repositoryId]
  );

  const repoEvents = useMemo(
    () =>
      activityEvents
        .filter((e) => e.repositoryId === repositoryId)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
    [activityEvents, repositoryId]
  );

  const repoSummaries = useMemo(
    () =>
      activitySummaries
        .filter((s) => s.repositoryId === repositoryId)
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime()),
    [activitySummaries, repositoryId]
  );

  const storedMemory = useMemo(
    () => projectMemory.find((m) => m.repositoryId === repositoryId) ?? null,
    [projectMemory, repositoryId]
  );

  const synthesized = useMemo(() => {
    if (!repository) return null;
    return synthesizeProjectMemoryFromHistory(
      repository,
      repoEvents,
      repoSummaries,
      storedMemory
    );
  }, [repository, repoEvents, repoSummaries, storedMemory]);

  const [objective, setObjective] = useState('');
  const [objectiveError, setObjectiveError] = useState<string | undefined>();
  const [savingObjective, setSavingObjective] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    setObjective(repository?.objective ?? '');
  }, [repository?.id, repository?.objective]);

  if (!loading && !repository) {
    return (
      <AppShell
        title="Repository not found"
        breadcrumbs={[
          { label: 'Projects', to: '/projects' },
          { label: 'Not found' },
        ]}
      >
        <EmptyState
          icon={<GitBranch className="w-5 h-5" />}
          title="Repository unavailable"
          description="This repository may have been disconnected or removed from your workspace."
          actionLabel="Back to Projects"
          onAction={() => navigate('/projects')}
        />
      </AppShell>
    );
  }

  const handleSaveObjective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repository) return;
    const err = validateObjective(objective);
    if (err) {
      setObjectiveError(err);
      return;
    }
    setObjectiveError(undefined);
    setSavingObjective(true);
    try {
      await updateRepositoryObjective(repository.id, objective);
      await refreshProjectMemory({ ...repository, objective: objective.trim() });
      showToast('Project objective updated and memory refreshed.', 'success');
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Failed to save objective.'), 'error');
    } finally {
      setSavingObjective(false);
    }
  };

  const handleTogglePause = async () => {
    if (!repository) return;
    const nextStatus = repository.status === 'active' ? 'paused' : 'active';
    setUpdatingStatus(true);
    try {
      await updateRepositoryStatus(repository.id, nextStatus);
      showToast(
        nextStatus === 'paused'
          ? `Paused automatic tracking for ${repository.fullName}.`
          : `Resumed automatic tracking for ${repository.fullName}.`,
        'info'
      );
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Could not update status.'), 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSync = async () => {
    if (!repository) return;
    try {
      const result = await syncRepositoryHistory(repository);
      showToast(
        `Imported ${result.insertedCount} new GitHub events for ${repository.fullName}.`,
        'success'
      );
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Repository sync failed.'), 'error');
    }
  };

  const handleSummarize = async () => {
    if (!repository) return;
    try {
      const res = await summarizeRepositoryPendingEvents(repository);
      if (res.status === 'ready') {
        showToast(`Generated summary across ${res.summarizedCount} events.`, 'success');
      } else {
        showToast(res.message || 'Summarization skipped; raw events preserved.', 'info');
      }
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Summarization failed.'), 'error');
    }
  };

  const pendingCount = repoEvents.filter(
    (e) =>
      e.processingStatus === 'pending' ||
      e.processingStatus === 'recorded_without_summary' ||
      e.processingStatus === 'failed'
  ).length;

  return (
    <AppShell
      title={repository?.fullName ?? 'Loading repository...'}
      subtitle={repository?.description || 'Automated GitHub repository activity and summaries.'}
      breadcrumbs={[
        { label: 'Projects', to: '/projects' },
        { label: repository?.fullName ?? 'Repository' },
      ]}
      actions={
        repository && (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={syncingRepoId === repository.id}
              disabled={repository.status !== 'active'}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void handleSync()}
            >
              Sync History
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={summarizingRepoId === repository.id}
              disabled={pendingCount === 0}
              icon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={() => void handleSummarize()}
            >
              Summarize ({pendingCount})
            </Button>
            <Link
              to={`/projects/${repository.id}/memory`}
              className={getButtonClasses('primary', 'sm')}
            >
              <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Resume Context</span>
            </Link>
          </>
        )
      }
    >
      {loading || !repository || !synthesized ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse"
              />
            ))}
          </div>
          <div className="h-64 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Vital Signs KPI Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Ingested Events</span>
                <GitCommit className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {repoEvents.length}
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Open PRs</span>
                <GitPullRequest className="w-4 h-4 text-emerald-300" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.openPullRequests.length}
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Open Issues</span>
                <AlertCircle className="w-4 h-4 text-amber-300" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.openIssues.length}
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Modified Areas</span>
                <FolderGit2 className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#B8F34A]">
                {synthesized.modifiedCodeAreas.length}
              </p>
            </div>
          </section>

          {/* Tracking Metadata + Objective Form */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                  Repository Tracking
                </h2>
                <RepositoryStatusLabel status={repository.status} />
              </div>

              <dl className="divide-y divide-[#252D24] text-sm">
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-[#929B90]">Default Branch</dt>
                  <dd className="font-mono text-xs text-[#FCFFEC]">{repository.defaultBranch}</dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-[#929B90]">Primary Language</dt>
                  <dd className="text-[#FCFFEC]">{repository.primaryLanguage || '—'}</dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-[#929B90]">Last Synced</dt>
                  <dd className="tabular-nums text-[#FCFFEC]">
                    {repository.lastSyncedAt ? formatShortDate(repository.lastSyncedAt) : 'Not synced yet'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-[#929B90]">AI Summaries</dt>
                  <dd className="font-mono tabular-nums text-xs text-[#B8F34A]">
                    {repoSummaries.length} generated
                  </dd>
                </div>
              </dl>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                {repository.status !== 'disconnected' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={updatingStatus}
                    icon={
                      repository.status === 'active' ? (
                        <PauseCircle className="w-3.5 h-3.5" />
                      ) : (
                        <PlayCircle className="w-3.5 h-3.5" />
                      )
                    }
                    onClick={() => void handleTogglePause()}
                  >
                    {repository.status === 'active' ? 'Pause Tracking' : 'Resume Tracking'}
                  </Button>
                )}
                {repository.htmlUrl && (
                  <a
                    href={repository.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={getButtonClasses('ghost', 'sm')}
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Open on GitHub</span>
                  </a>
                )}
              </div>
            </div>

            <form
              onSubmit={handleSaveObjective}
              className="lg:col-span-7 rounded-2xl border border-[#252D24] bg-[#121512] p-5 flex flex-col justify-between gap-4"
              noValidate
            >
              <div>
                <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                  Project Objective (Optional Context)
                </h2>
                <p className="mt-1 text-xs text-[#929B90]">
                  Supply a concise goal so automated Resume Project briefs combine your intent with verified GitHub activity.
                </p>
                <div className="mt-4">
                  <Textarea
                    label="Current Objective"
                    rows={3}
                    maxLength={SCHEMA_LIMITS.REPO_OBJECTIVE_MAX}
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="e.g., Harden GitHub webhook signature verification and ship read-only ingestion MVP."
                    error={objectiveError}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={savingObjective}
                  icon={<Save className="w-3.5 h-3.5" />}
                >
                  Save Objective
                </Button>
              </div>
            </form>
          </section>

          {/* Modified Code Areas & Open PR/Issue Radar */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                Modified Code Areas
              </h2>
              <p className="text-xs text-[#929B90]">
                Directories touched most frequently across recent ingested commits and PRs.
              </p>
              {synthesized.modifiedCodeAreas.length > 0 ? (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs font-mono">
                  {synthesized.modifiedCodeAreas.slice(0, 10).map((area, idx) => (
                    <li
                      key={idx}
                      className="rounded-lg border border-[#252D24] bg-[#080908] px-3 py-2 text-[#B8F34A] truncate"
                    >
                      {area}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#929B90] pt-1">
                  No changed file path metadata recorded yet.
                </p>
              )}
            </div>

            <div className="lg:col-span-6 rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                Open Pull Requests &amp; Issues
              </h2>

              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-mono text-emerald-300 mb-1.5">
                    Open Pull Requests ({synthesized.openPullRequests.length})
                  </p>
                  {synthesized.openPullRequests.length > 0 ? (
                    <ul className="space-y-1 text-[#F3F5EF]">
                      {synthesized.openPullRequests.slice(0, 5).map((pr, i) => (
                        <li key={i} className="truncate">• {pr}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[#929B90]">None open from ingested events.</p>
                  )}
                </div>

                <div className="pt-3 border-t border-[#252D24]">
                  <p className="font-mono text-amber-300 mb-1.5">
                    Open Issues ({synthesized.openIssues.length})
                  </p>
                  {synthesized.openIssues.length > 0 ? (
                    <ul className="space-y-1 text-[#F3F5EF]">
                      {synthesized.openIssues.slice(0, 5).map((iss, i) => (
                        <li key={i} className="truncate">• {iss}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[#929B90]">None open from ingested events.</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Automated Activity Summaries */}
          <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
            <div>
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                Automated Activity Summaries
              </h2>
              <p className="mt-0.5 text-xs text-[#929B90]">
                Verified GitHub evidence is kept strictly separate from metadata inferences and AI-suggested next checks.
              </p>
            </div>

            {repoSummaries.length === 0 ? (
              <div className="rounded-xl border border-[#252D24] bg-[#080908] p-4 text-xs text-[#929B90]">
                No summaries generated yet. Raw events are preserved below—click &ldquo;Summarize&rdquo; when pending events exist.
              </div>
            ) : (
              <div className="space-y-4">
                {repoSummaries.slice(0, 5).map((sum) => (
                  <article
                    key={sum.id}
                    className="rounded-xl border border-[#252D24] bg-[#080908] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-[#929B90]">
                      <span className="font-mono tabular-nums">
                        {sum.relatedEventIds.length}{' '}
                        {sum.relatedEventIds.length === 1 ? 'event' : 'events'} summarized
                      </span>
                      <span className="tabular-nums font-mono">{formatShortDate(sum.generatedAt)}</span>
                    </div>

                    <p className="text-sm text-[#FCFFEC] leading-relaxed">{sum.summary}</p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-[#252D24] text-xs">
                      <div>
                        <p className="font-mono text-[#B8F34A] mb-1.5">Verified GitHub Facts</p>
                        {sum.evidence.length > 0 ? (
                          <ul className="space-y-1 text-[#F3F5EF]/90 list-disc list-inside">
                            {sum.evidence.map((ev, i) => (
                              <li key={i}>{ev}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[#929B90]">None listed.</p>
                        )}
                      </div>

                      <div>
                        <p className="font-mono text-amber-300 mb-1.5">Metadata Inferences</p>
                        {sum.inferences.length > 0 ? (
                          <ul className="space-y-1 text-[#929B90] list-disc list-inside">
                            {sum.inferences.map((inf, i) => (
                              <li key={i}>{inf}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[#929B90]">No inferences recorded.</p>
                        )}
                      </div>

                      <div>
                        <p className="font-mono text-[#FCFFEC] mb-1.5">AI-Suggested Next Steps</p>
                        {sum.suggestedNextSteps.length > 0 ? (
                          <ul className="space-y-1 text-[#929B90] list-disc list-inside">
                            {sum.suggestedNextSteps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[#929B90]">None suggested.</p>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Raw Ingested GitHub Activity Events */}
          <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
            <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
              Ingested GitHub Events
            </h2>

            {repoEvents.length === 0 ? (
              <p className="text-sm text-[#929B90]">
                No commits, pull requests, or issues ingested yet. Click &ldquo;Sync History&rdquo; above or push a commit to GitHub.
              </p>
            ) : (
              <ul className="divide-y divide-[#252D24]">
                {repoEvents.slice(0, 30).map((ev) => (
                  <li key={ev.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <EventTypeLabel eventType={ev.eventType} />
                        <span className="text-xs font-mono text-[#929B90] tabular-nums">
                          {ev.branch}
                          {ev.commitSha ? ` · ${ev.commitSha.slice(0, 7)}` : ''}
                        </span>
                        {ev.author && (
                          <span className="text-xs text-[#929B90]">by {ev.author}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <ProcessingStatusLabel status={ev.processingStatus} />
                        <span className="text-xs font-mono text-[#929B90] tabular-nums">
                          {formatRelativeDate(ev.occurredAt)}
                        </span>
                        {ev.sourceUrl && (
                          <a
                            href={ev.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`View on GitHub: ${ev.title}`}
                            className="text-[#929B90] hover:text-[#B8F34A]"
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </div>

                    <p className="text-sm font-medium text-[#FCFFEC]">{ev.title}</p>

                    {ev.changedFiles.length > 0 && (
                      <p className="text-xs font-mono text-[#929B90] break-all">
                        Files ({ev.changedFiles.length}):{' '}
                        {ev.changedFiles.slice(0, 6).join(', ')}
                        {ev.changedFiles.length > 6
                          ? ` +${ev.changedFiles.length - 6} more`
                          : ''}
                      </p>
                    )}

                    {ev.errorMessage && (
                      <p className="text-xs text-amber-300 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{ev.errorMessage}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
