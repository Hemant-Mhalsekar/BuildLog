import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  ExternalLink,
  History,
  Search,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { EventTypeLabel, ProcessingStatusLabel } from '../components/ui/StatusLabel';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import type { ActivityEvent, GitHubEventType, ProcessingStatus } from '../types/models';
import { clusterActivityEvents } from '../utils/activityClustering';
import { formatRelativeDate, formatShortDate } from '../utils/dateUtils';
import { parseFriendlyFirestoreError } from '../lib/firebase';

const PAGE_SIZE = 15;

export function TimelinePage() {
  const {
    repositories,
    activityEvents,
    activitySummaries,
    loading,
    summarizingRepoId,
    summarizeRepositoryPendingEvents,
  } = useWorkspace();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [repoFilter, setRepoFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | GitHubEventType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ProcessingStatus>('all');
  const [viewMode, setViewMode] = useState<'events' | 'clusters'>('events');
  const [showAllJson, setShowAllJson] = useState(false);
  const [expandedJsonIds, setExpandedJsonIds] = useState<Set<string>>(new Set());
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (!isInput && e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const repoMap = useMemo(
    () => new Map(repositories.map((r) => [r.id, r])),
    [repositories]
  );

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activityEvents.filter((ev) => {
      if (repoFilter !== 'all' && ev.repositoryId !== repoFilter) return false;
      if (typeFilter !== 'all' && ev.eventType !== typeFilter) return false;
      if (statusFilter !== 'all' && ev.processingStatus !== statusFilter) return false;
      if (!q) return true;
      const repoName = repoMap.get(ev.repositoryId)?.fullName.toLowerCase() ?? '';
      return (
        ev.title.toLowerCase().includes(q) ||
        ev.description.toLowerCase().includes(q) ||
        ev.branch.toLowerCase().includes(q) ||
        repoName.includes(q) ||
        ev.changedFiles.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [activityEvents, repoFilter, typeFilter, statusFilter, search, repoMap]);

  const clusters = useMemo(
    () => clusterActivityEvents(filteredEvents, repositories),
    [filteredEvents, repositories]
  );

  const allClusters = useMemo(
    () => clusterActivityEvents(activityEvents, repositories),
    [activityEvents, repositories]
  );

  // 7-day ingestion pulse computed from real activityEvents
  const weeklyPulse = useMemo(() => {
    const days: Array<{ key: string; label: string; count: number }> = [];
    const now = new Date();
    const countsByDate = new Map<string, number>();

    for (const ev of activityEvents) {
      const key = ev.occurredAt.toISOString().slice(0, 10);
      countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
    }

    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      days.push({ key, label, count: countsByDate.get(key) ?? 0 });
    }
    return days;
  }, [activityEvents]);

  const maxPulse = Math.max(1, ...weeklyPulse.map((d) => d.count));

  const summarizedCount = useMemo(
    () => activityEvents.filter((e) => e.processingStatus === 'summarized').length,
    [activityEvents]
  );
  const coveragePct =
    activityEvents.length > 0
      ? Math.round((summarizedCount / activityEvents.length) * 100)
      : 0;
  const ringRadius = 26;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - coveragePct / 100);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedEvents = filteredEvents.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const toggleEventJson = (id: string) => {
    setExpandedJsonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyEvent = async (ev: ActivityEvent) => {
    const repoName = repoMap.get(ev.repositoryId)?.fullName ?? 'Repository';
    const text = `[${repoName} · ${ev.branch}${
      ev.commitSha ? ` · ${ev.commitSha.slice(0, 7)}` : ''
    }] ${ev.title}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEventId(ev.id);
      showToast('Event summary copied to clipboard.', 'success');
      window.setTimeout(() => setCopiedEventId(null), 1800);
    } catch {
      showToast('Clipboard access was denied.', 'error');
    }
  };

  const handleSummarizeSelectedRepo = async () => {
    const targetRepo =
      repoFilter !== 'all'
        ? repoMap.get(repoFilter)
        : repositories.find((r) =>
            activityEvents.some(
              (e) =>
                e.repositoryId === r.id &&
                (e.processingStatus === 'pending' ||
                  e.processingStatus === 'recorded_without_summary' ||
                  e.processingStatus === 'failed')
            )
          );

    if (!targetRepo) {
      showToast('No pending events found across connected repositories.', 'info');
      return;
    }

    try {
      const res = await summarizeRepositoryPendingEvents(targetRepo);
      if (res.status === 'ready') {
        showToast(
          `Summarized ${res.summarizedCount} events for ${targetRepo.fullName}.`,
          'success'
        );
      } else {
        showToast(res.message || 'Summarizer unavailable; raw events kept intact.', 'info');
      }
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Failed to summarize events.'), 'error');
    }
  };

  return (
    <AppShell
      title="Activity Timeline"
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Activity Timeline' }]}
      subtitle="Chronological GitHub commits, pull requests, issues, and inferred activity clusters."
      actions={
        repositories.length > 0 ? (
          <Button
            variant="primary"
            size="sm"
            loading={Boolean(summarizingRepoId)}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            onClick={() => void handleSummarizeSelectedRepo()}
          >
            Summarize Pending Events
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <div className="space-y-4">
          <div className="h-24 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse"
            />
          ))}
        </div>
      ) : activityEvents.length === 0 ? (
        <EmptyState
          icon={<History className="w-5 h-5" />}
          title="No GitHub activity recorded yet"
          description="Connect a GitHub repository and sync its history or push a commit to start populating your automated timeline."
          actionLabel="Open Integrations"
          onAction={() => navigate('/integrations')}
        />
      ) : (
        <div className="space-y-6">
          {/* Telemetry Summary Strip */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#929B90]">Total Ingested Events</p>
                <p className="mt-1 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                  {activityEvents.length}
                </p>
              </div>
              <History className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#929B90]">AI Summaries Generated</p>
                <p className="mt-1 text-2xl font-display font-bold tabular-nums text-[#B8F34A]">
                  {activitySummaries.length}
                </p>
              </div>
              <Sparkles className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-[#929B90]">Inferred Activity Clusters</p>
                <p className="mt-1 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                  {allClusters.length}
                </p>
              </div>
              <Code2 className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Main Timeline Column (8 cols) */}
            <div className="lg:col-span-8 space-y-5">
              {/* Filter Controls */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-6 relative">
                    <Search
                      className="w-4 h-4 text-[#929B90] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      ref={searchRef}
                      type="search"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Search commits, PRs, branches, or files..."
                      aria-label="Search timeline"
                      className="min-h-[40px] w-full rounded-lg border border-[#252D24] bg-[#080908] pl-10 pr-10 py-2 text-sm text-[#F3F5EF] placeholder:text-[#929B90]/60 focus:outline-none focus:border-[#B8F34A]"
                    />
                    <kbd className="hidden sm:inline-block absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[#929B90] bg-[#181B18] border border-[#252D24] rounded px-1.5 py-0.5 pointer-events-none">
                      /
                    </kbd>
                  </div>

                  <div className="sm:col-span-3">
                    <select
                      aria-label="Filter by event type"
                      value={typeFilter}
                      onChange={(e) => {
                        setTypeFilter(e.target.value as 'all' | GitHubEventType);
                        setPage(1);
                      }}
                      className="min-h-[40px] w-full rounded-lg border border-[#252D24] bg-[#080908] px-3 py-2 text-sm text-[#F3F5EF] focus:outline-none focus:border-[#B8F34A]"
                    >
                      <option value="all">All types</option>
                      <option value="push">Push commits</option>
                      <option value="pull_request">Pull requests</option>
                      <option value="issues">Issues</option>
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <select
                      aria-label="Filter by processing status"
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value as 'all' | ProcessingStatus);
                        setPage(1);
                      }}
                      className="min-h-[40px] w-full rounded-lg border border-[#252D24] bg-[#080908] px-3 py-2 text-sm text-[#F3F5EF] focus:outline-none focus:border-[#B8F34A]"
                    >
                      <option value="all">All statuses</option>
                      <option value="summarized">Summarized</option>
                      <option value="pending">Pending</option>
                      <option value="recorded_without_summary">Raw only</option>
                      <option value="failed">Failed</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#252D24]">
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-[#929B90] font-mono tabular-nums">
                      {filteredEvents.length} events · {clusters.length} clusters
                    </p>
                    {viewMode === 'events' && (
                      <button
                        type="button"
                        onClick={() => setShowAllJson((prev) => !prev)}
                        className={`inline-flex items-center gap-1.5 text-xs font-mono whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          showAllJson ? 'text-[#B8F34A]' : 'text-[#929B90] hover:text-[#FCFFEC]'
                        }`}
                      >
                        <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{showAllJson ? 'Hide Metadata JSON' : 'Show Metadata JSON'}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#080908] border border-[#252D24]">
                    <button
                      type="button"
                      onClick={() => setViewMode('events')}
                      className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        viewMode === 'events'
                          ? 'bg-[#181B18] text-[#B8F34A]'
                          : 'text-[#929B90] hover:text-[#FCFFEC]'
                      }`}
                    >
                      Chronological Events
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('clusters')}
                      className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        viewMode === 'clusters'
                          ? 'bg-[#181B18] text-[#B8F34A]'
                          : 'text-[#929B90] hover:text-[#FCFFEC]'
                      }`}
                    >
                      Inferred Clusters
                    </button>
                  </div>
                </div>
              </div>

              {filteredEvents.length === 0 ? (
                <EmptyState
                  icon={<Search className="w-5 h-5" />}
                  title="No matching activity events"
                  description="Try clearing your search or choosing another repository filter."
                />
              ) : viewMode === 'events' ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    {paginatedEvents.map((ev) => {
                      const repo = repoMap.get(ev.repositoryId);
                      const isJsonOpen = showAllJson || expandedJsonIds.has(ev.id);
                      const isCopied = copiedEventId === ev.id;

                      return (
                        <article
                          key={ev.id}
                          className="rounded-2xl border border-[#252D24] bg-[#121512] p-4 sm:p-5 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                              <EventTypeLabel eventType={ev.eventType} />
                              {repo && (
                                <Link
                                  to={`/projects/${repo.id}`}
                                  className="text-xs font-medium text-[#FCFFEC] hover:text-[#B8F34A]"
                                >
                                  {repo.fullName}
                                </Link>
                              )}
                              <span className="text-xs font-mono text-[#929B90] tabular-nums">
                                {ev.branch}
                                {ev.commitSha ? ` · ${ev.commitSha.slice(0, 7)}` : ''}
                              </span>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <ProcessingStatusLabel status={ev.processingStatus} />
                              <span className="text-xs font-mono text-[#929B90] tabular-nums">
                                {formatShortDate(ev.occurredAt)}
                              </span>
                            </div>
                          </div>

                          <h3 className="text-sm font-semibold text-[#FCFFEC]">{ev.title}</h3>

                          {ev.changedFiles.length > 0 && (
                            <p className="text-xs font-mono text-[#929B90] break-all">
                              Modified: {ev.changedFiles.slice(0, 8).join(', ')}
                              {ev.changedFiles.length > 8
                                ? ` +${ev.changedFiles.length - 8} more`
                                : ''}
                            </p>
                          )}

                          <div className="pt-2 border-t border-[#252D24] flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-mono text-[#929B90]">
                              {ev.author ? `Author: ${ev.author}` : 'GitHub Webhook / History'}
                            </span>

                            <div className="flex items-center gap-3 shrink-0">
                              <button
                                type="button"
                                onClick={() => void handleCopyEvent(ev)}
                                className="inline-flex items-center gap-1 text-xs text-[#929B90] hover:text-[#FCFFEC] whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                {isCopied ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-[#B8F34A]" />
                                    <span className="text-[#B8F34A]">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleEventJson(ev.id)}
                                className="inline-flex items-center gap-1 text-xs font-mono text-[#929B90] hover:text-[#B8F34A] whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>JSON</span>
                                {isJsonOpen ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>

                              {ev.sourceUrl && (
                                <a
                                  href={ev.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Open ${ev.title} on GitHub`}
                                  className="inline-flex items-center gap-1 text-xs text-[#929B90] hover:text-[#B8F34A] whitespace-nowrap shrink-0"
                                >
                                  <span>GitHub</span>
                                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                          </div>

                          {isJsonOpen && (
                            <pre className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 text-[11px] font-mono text-[#F3F5EF]/85 overflow-x-auto">
                              {JSON.stringify(
                                {
                                  eventId: ev.eventId,
                                  eventType: ev.eventType,
                                  branch: ev.branch,
                                  commitSha: ev.commitSha || null,
                                  author: ev.author || null,
                                  occurredAt: ev.occurredAt.toISOString(),
                                  processingStatus: ev.processingStatus,
                                  changedFiles: ev.changedFiles,
                                },
                                null,
                                2
                              )}
                            </pre>
                          )}
                        </article>
                      );
                    })}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between gap-3 pt-2">
                      <span className="text-xs text-[#929B90] font-mono tabular-nums">
                        Page {safePage} of {totalPages}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={safePage <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={safePage >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-[#929B90]">
                    Activity clusters are inferred automatically from GitHub events occurring within 90 minutes on the same repository. They do not represent verified hours worked.
                  </p>
                  {clusters.map((cluster) => (
                    <article
                      key={cluster.clusterId}
                      className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <Link
                            to={`/projects/${cluster.repositoryId}`}
                            className="text-base font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A]"
                          >
                            {cluster.repositoryName}
                          </Link>
                          <p className="text-xs text-[#B8F34A] mt-0.5">{cluster.label}</p>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-[#929B90] shrink-0">
                          {formatRelativeDate(cluster.endAt)} · {formatShortDate(cluster.endAt)}
                        </span>
                      </div>

                      <ul className="space-y-1.5 border-t border-[#252D24] pt-3">
                        {cluster.events.slice(0, 6).map((ev) => (
                          <li
                            key={ev.id}
                            className="flex items-center justify-between gap-3 text-xs text-[#F3F5EF]"
                          >
                            <span className="truncate">{ev.title}</span>
                            <span className="font-mono text-[#929B90] shrink-0">
                              {ev.commitSha ? ev.commitSha.slice(0, 7) : ev.eventType}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* Right Sidebar Rail (4 cols) */}
            <aside className="lg:col-span-4 space-y-5">
              {/* 7-Day Ingestion Pulse */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
                <h2 className="text-sm font-display font-semibold text-[#FCFFEC]">
                  7-Day Ingestion Pulse
                </h2>
                <p className="mt-0.5 text-xs text-[#929B90]">
                  Events captured across your connected repositories.
                </p>

                <div className="mt-5 grid grid-cols-7 gap-2 items-end h-32">
                  {weeklyPulse.map((day) => {
                    const pct = Math.round((day.count / maxPulse) * 100);
                    return (
                      <div
                        key={day.key}
                        className="flex flex-col items-center justify-end h-full gap-1.5"
                      >
                        <span className="text-[11px] font-mono tabular-nums text-[#929B90]">
                          {day.count}
                        </span>
                        <div className="w-full max-w-[24px] h-20 rounded-md bg-[#080908] border border-[#252D24] flex items-end overflow-hidden">
                          <div
                            className="w-full bg-[#B8F34A]"
                            style={{ height: `${day.count > 0 ? Math.max(12, pct) : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-[#929B90]">{day.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summarization Coverage Ring */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 flex items-center gap-4">
                <svg className="w-16 h-16 -rotate-90 shrink-0" viewBox="0 0 64 64" aria-hidden="true">
                  <circle
                    cx="32"
                    cy="32"
                    r={ringRadius}
                    fill="none"
                    stroke="#252D24"
                    strokeWidth="6"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r={ringRadius}
                    fill="none"
                    stroke="#B8F34A"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <div className="min-w-0">
                  <p className="text-xs font-mono text-[#929B90]">AI Summary Coverage</p>
                  <p className="text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                    {coveragePct}%
                  </p>
                  <p className="text-xs text-[#929B90] tabular-nums">
                    {summarizedCount} of {activityEvents.length} events summarized
                  </p>
                </div>
              </div>

              {/* Repository Quick Filter */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-display font-semibold text-[#FCFFEC]">
                    Filter by Repository
                  </h2>
                  {repoFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => {
                        setRepoFilter('all');
                        setPage(1);
                      }}
                      className="text-xs text-[#B8F34A] hover:underline cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <ul className="space-y-1">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setRepoFilter('all');
                        setPage(1);
                      }}
                      className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer ${
                        repoFilter === 'all'
                          ? 'bg-[#181B18] text-[#B8F34A] font-medium'
                          : 'text-[#929B90] hover:text-[#FCFFEC] hover:bg-[#080908]'
                      }`}
                    >
                      <span>All repositories</span>
                      <span className="font-mono tabular-nums">{activityEvents.length}</span>
                    </button>
                  </li>
                  {repositories.map((repo) => {
                    const count = activityEvents.filter(
                      (e) => e.repositoryId === repo.id
                    ).length;
                    const active = repoFilter === repo.id;
                    return (
                      <li key={repo.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setRepoFilter(repo.id);
                            setPage(1);
                          }}
                          className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#181B18] text-[#B8F34A] font-medium'
                              : 'text-[#929B90] hover:text-[#FCFFEC] hover:bg-[#080908]'
                          }`}
                        >
                          <span className="truncate font-mono">{repo.fullName}</span>
                          <span className="font-mono tabular-nums shrink-0">{count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      )}
    </AppShell>
  );
}
