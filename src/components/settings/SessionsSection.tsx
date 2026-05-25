/**
 * Active-sessions panel for Settings → Account.
 *
 * Renders the user's currently-signed-in devices (up to 5, FIFO-capped
 * server-side) with revoke controls. The "current" session — the
 * browser this page is open in — is highlighted and its revoke button
 * is replaced with a non-action label (revoking yourself is what
 * Logout is for).
 *
 * Calls:
 *   GET    /api/auth/sessions             — initial load + refresh-after-action
 *   DELETE /api/auth/sessions/:id         — revoke one
 *   DELETE /api/auth/sessions             — revoke all OTHER (keeps this device)
 *
 * No real-time updates — the list is fetched once on mount and after
 * every action. Two CAs at the same firm rarely revoke each other's
 * sessions simultaneously; polling would burn API calls for almost
 * zero practical benefit.
 */

import { useEffect, useState } from 'react';
import { ShieldCheck, LogOut, Loader2, Monitor } from 'lucide-react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import {
  listSessions,
  revokeSession,
  revokeAllOtherSessions,
  type ActiveSession,
} from '../../services/api';

interface Props {
  /** Tailwind class strings shared with SettingsPage so this section
   *  inherits the page's button style. Passed in instead of imported
   *  to avoid coupling to SettingsPage's internal token names. */
  buttonPrimary: string;
}

function relativeTime(iso: string): string {
  // Server emits IST timestamps without a Z suffix. Treat them as IST
  // by appending the offset so the JS Date constructor doesn't read
  // them as local browser time (which would be wrong for users
  // outside India and produce weird "in 5h" relatives).
  const then = new Date(iso.includes('T') ? iso + '+05:30' : iso.replace(' ', 'T') + '+05:30').getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(diff)) return iso;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso + '+05:30').toLocaleDateString();
}

export function SessionsSection({ buttonPrimary }: Props) {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [maxSessions, setMaxSessions] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAllOther, setRevokingAllOther] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const data = await listSessions();
      setSessions(data.sessions);
      setMaxSessions(data.maxSessions);
    } catch (e) {
      setError((e as Error).message ?? 'Could not load active sessions');
      setSessions([]);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await revokeSession(id);
      toast.success('Session revoked');
      await refresh();
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not revoke session');
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAllOther() {
    setRevokingAllOther(true);
    try {
      const res = await revokeAllOtherSessions();
      toast.success(
        res.revoked === 0
          ? 'No other devices were signed in'
          : `Signed out ${res.revoked} other device${res.revoked === 1 ? '' : 's'}`,
      );
      await refresh();
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not sign out other devices');
    } finally {
      setRevokingAllOther(false);
    }
  }

  const otherSessionsCount = (sessions ?? []).filter(s => !s.current).length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        You can be signed in on up to <span className="font-semibold">{maxSessions}</span> devices at once.
        The oldest session is automatically signed out when you sign in on a new device beyond that.
      </p>

      {sessions === null && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading active sessions…
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 py-2">{error}</div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="space-y-2">
          {sessions.map(s => (
            <li
              key={s.id}
              className={cn(
                'rounded-xl border p-3 flex items-start gap-3',
                s.current
                  ? 'bg-emerald-50/60 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/40'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800',
              )}
            >
              <div className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                s.current
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
              )}>
                <Monitor className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {s.deviceLabel}
                  </span>
                  {s.current && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-700/60">
                      <ShieldCheck className="w-3 h-3" /> THIS DEVICE
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5" title={s.userAgent ?? ''}>
                  {s.ip ? `IP ${s.ip} · ` : ''}Last active {relativeTime(s.lastSeenAt)} · Signed in {relativeTime(s.createdAt)}
                </p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => handleRevoke(s.id)}
                  disabled={revokingId === s.id}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {revokingId === s.id ? 'Revoking…' : 'Sign out'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sessions && otherSessionsCount > 0 && (
        <div className="pt-2">
          <button
            type="button"
            onClick={handleRevokeAllOther}
            disabled={revokingAllOther}
            className={cn(buttonPrimary, 'flex items-center gap-2')}
          >
            {revokingAllOther ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Signing out…</>
            ) : (
              <><LogOut className="w-4 h-4" /> Sign out of all other devices</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
