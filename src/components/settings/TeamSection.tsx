import { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, Trash2, Copy, Check, AlertCircle } from 'lucide-react';
import {
  fetchInvitations,
  createInvitation,
  revokeInvitation,
  InvitationsListResponse,
} from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';

/**
 * Team management section for the Settings page. Visible to enterprise-plan
 * users. Shows seat usage, an invite form (email or phone), the list of
 * pending/accepted/revoked invitations, and the current accepted members.
 *
 * Gating: the section renders a short explainer when the user is on free/pro
 * so the feature is discoverable without needing to upgrade first.
 */
export function TeamSection() {
  const { user } = useAuth();
  const [data, setData] = useState<InvitationsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchInvitations();
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isEnterprise = user?.plan === 'enterprise';

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) {
      toast.error('Enter an email or phone to invite');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createInvitation({
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setEmail('');
      setPhone('');
      setLastCreatedUrl(created.acceptUrl);
      if (created.email && created.emailSent) {
        toast.success('Invitation email sent');
      } else if (created.email && !created.emailSent) {
        toast.success('Invitation created — email delivery pending');
      } else {
        toast.success('Invitation created — copy the link to share');
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string, kind: 'pending' | 'accepted') => {
    const confirmMsg =
      kind === 'accepted'
        ? 'Detach this team member? Their future usage will count against themselves, not the shared pool.'
        : 'Revoke this pending invitation?';
    if (!window.confirm(confirmMsg)) return;
    try {
      await revokeInvitation(id);
      toast.success(kind === 'accepted' ? 'Member detached' : 'Invitation revoked');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revoke failed');
    }
  };

  const copyInviteLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select and copy manually');
    }
  };

  // Free / pro explainer — visible so non-enterprise users see the feature exists
  if (!isEnterprise) {
    return (
      <div className="rounded-2xl border p-6 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
            <Users className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Team (Enterprise only)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Invite up to 9 teammates to share your Enterprise plan. All members draw from one combined pool of messages, uploads, notices, and profiles.
            </p>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Your current plan: <strong className="capitalize">{user?.plan ?? 'free'}</strong>. Upgrade to Enterprise to invite team members.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-6 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
          <Users className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Team</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Invite teammates to share your Enterprise plan's combined yearly token budget. Max 10 members total (you + 9 invitees).
          </p>
        </div>
        {data && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
            {data.seats.total} / {data.seats.cap} seats
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-300 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <>
          {/* Invite form */}
          <form onSubmit={handleInvite} className="space-y-3 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-800 dark:text-gray-100"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="or phone: 9999999999"
                className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-800 dark:text-gray-100"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500 dark:text-gray-500">
                Enter an email (we'll send a link) OR a phone number (copy-and-share the link manually).
              </p>
              <button
                type="submit"
                disabled={submitting || data.seats.total >= data.seats.cap || !data.canInvite}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white rounded-lg transition-colors shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                Invite
              </button>
            </div>
            {!data.canInvite && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                You can't invite others — only enterprise account owners can manage team members.
              </p>
            )}
          </form>

          {lastCreatedUrl && (
            <div className="mb-5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40">
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
                Share this link with the invitee (expires in 7 days):
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] text-emerald-800 dark:text-emerald-200 font-mono truncate bg-white dark:bg-emerald-950/30 px-2 py-1 rounded">
                  {lastCreatedUrl}
                </code>
                <button
                  onClick={() => copyInviteLink(lastCreatedUrl)}
                  className="p-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors"
                  title="Copy link"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Accepted members */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Members ({data.members.length + 1})
            </p>
            <div className="space-y-1">
              <MemberRow name={(user?.name ?? '') + ' (you)'} email={user?.email ?? ''} kind="owner" />
              {data.members.map((m) => (
                <MemberRow
                  key={m.id}
                  name={m.name}
                  email={m.email}
                  kind="member"
                  onDetach={() => {
                    // Detach requires finding the corresponding accepted invitation row
                    const inv = data.invitations.find(
                      (i) => i.status === 'accepted' && i.email === m.email,
                    );
                    if (inv) void handleRevoke(inv.id, 'accepted');
                    else toast.error('Could not find invitation record to detach');
                  }}
                />
              ))}
            </div>
          </div>

          {/* Pending invitations */}
          {data.invitations.filter((i) => i.status === 'pending').length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Pending invites
              </p>
              <div className="space-y-1">
                {data.invitations
                  .filter((i) => i.status === 'pending')
                  .map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-gray-200 dark:border-gray-800"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-800 dark:text-gray-200 truncate">
                          {inv.email || inv.phone || '(unknown)'}
                        </p>
                        <p className="text-[11px] text-gray-400">Expires {(() => { const d = new Date(inv.expires_at + '+05:30'); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; })()}</p>
                      </div>
                      <button
                        onClick={() => handleRevoke(inv.id, 'pending')}
                        className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="Revoke invitation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MemberRow({
  name,
  email,
  kind,
  onDetach,
}: {
  name: string;
  email: string;
  kind: 'owner' | 'member';
  onDetach?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 p-2.5 rounded-lg',
        kind === 'owner'
          ? 'bg-emerald-50/60 dark:bg-emerald-900/15 border border-emerald-100 dark:border-emerald-900/30'
          : 'border border-gray-200 dark:border-gray-800',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{name}</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-500 truncate">{email}</p>
      </div>
      {kind === 'member' && onDetach && (
        <button
          onClick={onDetach}
          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          title="Detach member"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
