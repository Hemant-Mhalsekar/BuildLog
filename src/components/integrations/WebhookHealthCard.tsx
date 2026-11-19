import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Plug,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { Button, getButtonClasses } from '../ui/Button';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { formatRelativeDate, formatShortDate } from '../../utils/dateUtils';
import {
  computeWebhookHealthStatus,
  type WebhookHealthLevel,
} from '../../utils/webhookHealth';

interface WebhookHealthCardProps {
  variant?: 'dashboard' | 'integrations';
  onOpenDiagnostics?: () => void;
}

const LEVEL_STYLES: Record<
  WebhookHealthLevel,
  {
    badgeLabel: string;
    icon: React.ReactNode;
    borderClass: string;
    iconWrapClass: string;
    textAccentClass: string;
  }
> = {
  healthy: {
    badgeLabel: 'Live & Verified',
    icon: <CheckCircle2 className="w-5 h-5 text-[#B8F34A]" aria-hidden="true" />,
    borderClass: 'border-[#B8F34A]/35',
    iconWrapClass: 'bg-[#B8F34A]/10 border-[#B8F34A]/30',
    textAccentClass: 'text-[#B8F34A]',
  },
  awaiting_events: {
    badgeLabel: 'Armed · Awaiting Events',
    icon: <Radio className="w-5 h-5 text-[#B8F34A]" aria-hidden="true" />,
    borderClass: 'border-[#252D24]',
    iconWrapClass: 'bg-[#B8F34A]/10 border-[#252D24]',
    textAccentClass: 'text-[#B8F34A]',
  },
  degraded: {
    badgeLabel: 'Attention Needed',
    icon: <AlertTriangle className="w-5 h-5 text-amber-300" aria-hidden="true" />,
    borderClass: 'border-amber-500/40',
    iconWrapClass: 'bg-amber-950/40 border-amber-500/40',
    textAccentClass: 'text-amber-300',
  },
  setup_required: {
    badgeLabel: 'Not Connected',
    icon: <Plug className="w-5 h-5 text-amber-300" aria-hidden="true" />,
    borderClass: 'border-[#252D24]',
    iconWrapClass: 'bg-amber-950/30 border-amber-500/30',
    textAccentClass: 'text-amber-300',
  },
};

export function WebhookHealthCard({
  variant = 'dashboard',
  onOpenDiagnostics,
}: WebhookHealthCardProps) {
  const {
    githubStatus,
    integrations,
    repositories,
    recentDeliveries,
    lastWebhookCheckedAt,
    checkingWebhookHealth,
    refreshGitHubStatusAndHealth,
  } = useWorkspace();

  const health = useMemo(
    () =>
      computeWebhookHealthStatus({
        githubStatus,
        integrations,
        repositories,
        recentDeliveries,
        lastCheckedAt: lastWebhookCheckedAt,
      }),
    [githubStatus, integrations, repositories, recentDeliveries, lastWebhookCheckedAt]
  );

  const style = LEVEL_STYLES[health.level];

  const formatTimestampDisplay = (date: Date | null, emptyText: string) => {
    if (!date) {
      return {
        primary: emptyText,
        secondary: 'No timestamp recorded yet',
      };
    }
    return {
      primary: formatRelativeDate(date),
      secondary: `${formatShortDate(date)} · ${date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    };
  };

  const lastSyncedInfo = formatTimestampDisplay(health.latestSyncedAt, 'Never synced');
  const lastWebhookInfo = formatTimestampDisplay(health.latestWebhookAt, 'No events yet');

  return (
    <section
      aria-label="GitHub webhook connectivity health"
      className={`rounded-2xl border ${style.borderClass} bg-[#121512] p-5 sm:p-6 space-y-4`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl border ${style.iconWrapClass} flex items-center justify-center shrink-0`}
          >
            {style.icon}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-sm sm:text-base font-display font-semibold text-[#FCFFEC]">
                GitHub Sync &amp; Webhook Health
              </h2>
              <span aria-hidden="true" className="text-[#5F665D]">
                ·
              </span>
              <span className={`text-xs font-mono font-medium ${style.textAccentClass}`}>
                {health.headline}
              </span>
            </div>
            <p className="text-xs text-[#929B90] leading-relaxed">
              {health.description}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            loading={checkingWebhookHealth}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => void refreshGitHubStatusAndHealth()}
          >
            Refresh Status
          </Button>
          {variant === 'dashboard' ? (
            <Link to="/integrations" className={getButtonClasses('ghost', 'sm')}>
              <span>Manage Connections</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </Link>
          ) : onOpenDiagnostics ? (
            <Button variant="ghost" size="sm" onClick={onOpenDiagnostics}>
              <span>Advanced Diagnostics</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* 4-Column Real-Time Telemetry Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#252D24] bg-[#080908] px-4 py-3 space-y-1">
          <p className="text-[11px] font-mono text-[#929B90]">Connectivity Health</p>
          <p className={`text-sm font-semibold ${style.textAccentClass}`}>
            {style.badgeLabel}
          </p>
          <p className="text-[11px] font-mono text-[#929B90] tabular-nums">
            {health.activeReposCount} active{' '}
            {health.activeReposCount === 1 ? 'repo' : 'repos'} ·{' '}
            {health.connectedInstallationsCount}{' '}
            {health.connectedInstallationsCount === 1 ? 'account' : 'accounts'}
          </p>
        </div>

        <div className="rounded-xl border border-[#252D24] bg-[#080908] px-4 py-3 space-y-1">
          <p className="text-[11px] font-mono text-[#929B90]">Last Synced</p>
          <p className="text-sm font-semibold text-[#FCFFEC] tabular-nums">
            {lastSyncedInfo.primary}
          </p>
          <p className="text-[11px] font-mono text-[#929B90] tabular-nums truncate">
            {lastSyncedInfo.secondary}
          </p>
        </div>

        <div className="rounded-xl border border-[#252D24] bg-[#080908] px-4 py-3 space-y-1">
          <p className="text-[11px] font-mono text-[#929B90]">Last Webhook Event</p>
          <p className="text-sm font-semibold text-[#FCFFEC] tabular-nums">
            {lastWebhookInfo.primary}
          </p>
          <p className="text-[11px] font-mono text-[#929B90] tabular-nums truncate">
            {lastWebhookInfo.secondary}
          </p>
        </div>

        <div className="rounded-xl border border-[#252D24] bg-[#080908] px-4 py-3 space-y-1">
          <p className="text-[11px] font-mono text-[#929B90]">Webhook Deliveries</p>
          <p className="text-sm font-semibold text-[#FCFFEC] tabular-nums">
            {health.deliveryCount} recent
            {health.failedOrUnmappedCount > 0 ? (
              <span className="text-amber-300">
                {' '}
                · {health.failedOrUnmappedCount} flagged
              </span>
            ) : null}
          </p>
          <p className="text-[11px] font-mono text-[#929B90] tabular-nums truncate">
            {health.lastCheckedAt
              ? `Checked ${formatRelativeDate(health.lastCheckedAt)}`
              : 'Auto-checking every 15s'}
          </p>
        </div>
      </div>
    </section>
  );
}
