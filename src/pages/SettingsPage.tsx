import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, LogOut, MailCheck, Save, Shield, Trash2, User } from 'lucide-react';
import { sendEmailVerification } from 'firebase/auth';
import { AppShell } from '../components/layout/AppShell';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Input, Select } from '../components/ui/FormFields';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import {
  logout,
  updateUserDisplayName,
  updateUserPrivacySettings,
} from '../services/authService';
import { deleteAllUserBuildLogData } from '../services/dbService';
import { purgeServerAccountData } from '../services/apiClient';
import { parseFriendlyFirestoreError } from '../lib/firebase';
import { formatShortDate } from '../utils/dateUtils';
import { buildPersonalJsonExport, downloadTextFile } from '../utils/exportData';
import { SCHEMA_LIMITS, validateDisplayName } from '../utils/validation';

export function SettingsPage() {
  const { user, userProfile } = useAuth();
  const {
    integrations,
    repositories,
    activityEvents,
    activitySummaries,
    projectMemory,
  } = useWorkspace();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [savingProfile, setSavingProfile] = useState(false);

  const [optInCodeDiff, setOptInCodeDiff] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const [sendingVerify, setSendingVerify] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingData, setDeletingData] = useState(false);

  useEffect(() => {
    const resolved =
      userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || '';
    setDisplayName(resolved);
    setOptInCodeDiff(Boolean(userProfile?.optInCodeDiff ?? false));
    setRetentionDays(userProfile?.retentionDays ?? 365);
  }, [userProfile, user]);

  const handleSaveAll = async () => {
    if (!user) return;
    const err = validateDisplayName(displayName);
    if (err) {
      setNameError(err);
      return;
    }
    setNameError(undefined);
    setSavingProfile(true);
    setSavingPrivacy(true);
    try {
      await updateUserDisplayName(user, displayName);
      await updateUserPrivacySettings(user, {
        optInCodeDiff,
        retentionDays,
      });
      showToast('Profile and privacy preferences saved.', 'success');
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Failed to save settings.'), 'error');
    } finally {
      setSavingProfile(false);
      setSavingPrivacy(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSaveAll();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const err = validateDisplayName(displayName);
    if (err) {
      setNameError(err);
      return;
    }
    setNameError(undefined);
    setSavingProfile(true);
    try {
      await updateUserDisplayName(user, displayName);
      showToast('Profile display name updated.', 'success');
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Failed to update profile.'), 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePrivacy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingPrivacy(true);
    try {
      await updateUserPrivacySettings(user, {
        optInCodeDiff,
        retentionDays,
      });
      showToast('Privacy and retention preferences saved.', 'success');
    } catch (error) {
      showToast(
        parseFriendlyFirestoreError(error, 'Failed to save privacy settings.'),
        'error'
      );
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleExportJson = () => {
    const payload = buildPersonalJsonExport(
      userProfile,
      integrations,
      repositories,
      activityEvents,
      activitySummaries,
      projectMemory
    );
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `buildlog-export-${dateStamp}.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    showToast(`Exported ${filename}`, 'success');
  };

  const handleSendVerification = async () => {
    if (!user) return;
    setSendingVerify(true);
    try {
      await sendEmailVerification(user);
      showToast('Verification email sent. Check your inbox.', 'success');
    } catch {
      showToast('Could not send verification email right now.', 'error');
    } finally {
      setSendingVerify(false);
    }
  };

  const handleDeleteAllData = async () => {
    if (!user) return;
    setDeletingData(true);
    try {
      await deleteAllUserBuildLogData(user.uid);
      await purgeServerAccountData().catch(() => {});
      showToast('All connected integrations, repositories, events, and memories deleted.', 'info');
      setDeleteDialogOpen(false);
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, 'Failed to delete workspace data.'), 'error');
    } finally {
      setDeletingData(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      showToast('Signed out of BuildLog.', 'info');
      navigate('/login', { replace: true });
    } catch {
      showToast('Unable to sign out right now.', 'error');
      setSigningOut(false);
    }
  };

  const email = userProfile?.email || user?.email || '';
  const createdText = userProfile?.createdAt ? formatShortDate(userProfile.createdAt) : '—';

  return (
    <AppShell
      title="Settings & Privacy"
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Settings' }]}
      subtitle="Manage your profile, metadata-only privacy defaults, JSON data export, or account purge."
      actions={
        <Button
          variant="primary"
          size="sm"
          loading={savingProfile || savingPrivacy}
          icon={<Save className="w-3.5 h-3.5" />}
          onClick={() => void handleSaveAll()}
        >
          Save Changes
        </Button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start max-w-5xl">
        {/* Left Jump Navigation */}
        <aside className="lg:col-span-3 rounded-2xl border border-[#252D24] bg-[#121512] p-3 lg:sticky lg:top-6">
          <p className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#929B90]">
            Sections
          </p>
          <nav aria-label="Settings sections" className="space-y-1 text-xs font-medium">
            {[
              { href: '#profile', label: 'User Profile' },
              { href: '#privacy', label: 'Privacy & Retention' },
              { href: '#summary', label: 'Stored Workspace' },
              { href: '#data-actions', label: 'Export & Danger Zone' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="block rounded-lg px-3 py-2 text-[#929B90] hover:text-[#FCFFEC] hover:bg-[#181B18] transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Main Settings Stack */}
        <div className="lg:col-span-9 space-y-6">
          {/* Profile Card */}
          <section id="profile" className="rounded-2xl border border-[#252D24] bg-[#121512] p-6">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">User Profile</h2>
            </div>
            <p className="mt-1 text-xs text-[#929B90]">
              Your display name is shown across your workspace and personal data exports.
            </p>

            <form onSubmit={handleSaveProfile} className="mt-5 space-y-4" noValidate>
              <Input
                label="Display Name"
                required
                maxLength={SCHEMA_LIMITS.DISPLAY_NAME_MAX}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                error={nameError}
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#FCFFEC]">Account Email</label>
                <div className="min-h-[42px] rounded-lg border border-[#252D24] bg-[#080908] px-3.5 py-2.5 text-sm text-[#929B90] flex items-center justify-between gap-2">
                  <span className="truncate">{email}</span>
                  {user?.emailVerified ? (
                    <span className="text-xs font-mono text-[#B8F34A] shrink-0">Verified</span>
                  ) : (
                    <button
                      type="button"
                      disabled={sendingVerify}
                      onClick={handleSendVerification}
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:underline shrink-0 cursor-pointer"
                    >
                      <MailCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{sendingVerify ? 'Sending...' : 'Verify email'}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={savingProfile}
                  icon={<Save className="w-4 h-4" />}
                >
                  Save Profile
                </Button>
              </div>
            </form>
          </section>

          {/* Privacy & Retention Controls */}
          <section id="privacy" className="rounded-2xl border border-[#252D24] bg-[#121512] p-6">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                Privacy &amp; Data Retention
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#929B90] leading-relaxed">
              By default, BuildLog ingests repository metadata only (commit titles, branch names, file paths, PRs, and issues) without storing full source code snapshots.
            </p>

            <form onSubmit={handleSavePrivacy} className="mt-5 space-y-4">
              <label className="flex items-start gap-3 rounded-xl border border-[#252D24] bg-[#080908] p-3.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={optInCodeDiff}
                  onChange={(e) => setOptInCodeDiff(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#B8F34A]"
                />
                <div>
                  <p className="text-sm font-medium text-[#FCFFEC]">
                    Opt in to extended diff context during summarization
                  </p>
                  <p className="mt-0.5 text-xs text-[#929B90]">
                    Disabled by default. When enabled, future optional diff inspection may include bounded patch context during summary generation.
                  </p>
                </div>
              </label>

              <Select
                label="Activity Retention Window"
                value={String(retentionDays)}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
              >
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days (Default)</option>
                <option value="730">730 days</option>
              </Select>

              <div className="pt-1 flex justify-end">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={savingPrivacy}
                  icon={<Save className="w-4 h-4" />}
                >
                  Save Privacy Settings
                </Button>
              </div>
            </form>
          </section>

          {/* Account Information */}
          <section id="summary" className="rounded-2xl border border-[#252D24] bg-[#121512] p-6">
            <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
              Stored Workspace Summary
            </h2>
            <dl className="mt-4 divide-y divide-[#252D24] text-sm">
              <div className="py-3 flex items-center justify-between gap-4">
                <dt className="text-[#929B90]">User ID</dt>
                <dd className="font-mono text-xs text-[#FCFFEC] truncate max-w-xs">{user?.uid}</dd>
              </div>
              <div className="py-3 flex items-center justify-between gap-4">
                <dt className="text-[#929B90]">Account Created</dt>
                <dd className="tabular-nums text-[#FCFFEC]">{createdText}</dd>
              </div>
              <div className="py-3 flex items-center justify-between gap-4">
                <dt className="text-[#929B90]">Tracked Records</dt>
                <dd className="font-mono tabular-nums text-xs text-[#FCFFEC]">
                  {integrations.length} integrations · {repositories.length} repos ·{' '}
                  {activityEvents.length} events · {activitySummaries.length} summaries
                </dd>
              </div>
            </dl>
          </section>

          {/* Export, Delete & Sign Out */}
          <div id="data-actions" className="space-y-4">
            <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                  Export Personal Data
                </h2>
                <p className="mt-1 text-xs text-[#929B90] leading-relaxed">
                  Download all your integrations, repositories, activity events, summaries, and project memory as JSON.
                </p>
              </div>
              <Button
                variant="secondary"
                icon={<Download className="w-4 h-4" />}
                onClick={handleExportJson}
              >
                Export JSON
              </Button>
            </section>

            <section className="rounded-2xl border border-red-900/50 bg-[#121512] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                  Delete All BuildLog Data
                </h2>
                <p className="mt-1 text-xs text-[#929B90] leading-relaxed">
                  Permanently remove all GitHub installations, repositories, activity events, summaries, and project memories.
                </p>
              </div>
              <Button
                variant="danger"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={() => setDeleteDialogOpen(true)}
              >
                Delete Data
              </Button>
            </section>

            <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-display font-semibold text-[#FCFFEC]">Sign Out</h2>
                <p className="mt-1 text-xs text-[#929B90]">
                  End your active BuildLog session on this browser.
                </p>
              </div>
              <Button
                variant="secondary"
                loading={signingOut}
                icon={<LogOut className="w-4 h-4" />}
                onClick={handleSignOut}
              >
                Sign Out
              </Button>
            </section>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteAllData}
        loading={deletingData}
        title="Delete all BuildLog workspace data?"
        message="This permanently removes your connected GitHub integrations, repositories, activity events, AI summaries, and project memories from BuildLog. Your GitHub repositories themselves are untouched."
        confirmLabel="Permanently Delete Data"
      />
    </AppShell>
  );
}
