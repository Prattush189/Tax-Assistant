import { useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LoadingAnimation } from '../ui/LoadingAnimation';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import {
  isAllowedOrigin,
  parseParentMessage,
  postToParent,
  type SsoPayload,
} from '../../lib/pluginProtocol';

interface PluginAuthBridgeProps {
  children: ReactNode;
}

type BridgeState =
  | { status: 'idle' }
  | { status: 'handshaking' }
  | { status: 'ready' }
  | { status: 'error'; message: string }
  | { status: 'timeout' };

const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * Gate the app in plugin mode behind an SSO handshake with the parent window.
 *
 * Flow:
 *   1. If AuthContext already has a user (returning session) → render children immediately
 *   2. Otherwise post PLUGIN_SSO_REQUEST to parent and wait for PLUGIN_SSO
 *   3. On PLUGIN_SSO → POST /api/auth/plugin-sso → persist tokens → render children
 *   4. On timeout / verification failure → fall back to the normal login page
 */
export function PluginAuthBridge({ children }: PluginAuthBridgeProps) {
  const { user, isLoading, loginWithSso } = useAuth();
  const [bridge, setBridge] = useState<BridgeState>({ status: 'idle' });
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');

  const performHandshake = useCallback(
    async (payload: SsoPayload) => {
      setBridge({ status: 'handshaking' });
      try {
        const res = await fetch('/api/auth/plugin-sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `SSO failed with status ${res.status}`);
        }
        loginWithSso(data.accessToken, data.refreshToken, data.user);
        postToParent({ type: 'PLUGIN_SSO_OK', userId: payload.userId });
        setBridge({ status: 'ready' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown SSO error';
        postToParent({ type: 'PLUGIN_SSO_ERROR', error: message });
        setBridge({ status: 'error', message });
      }
    },
    [loginWithSso],
  );

  // Listen for PLUGIN_SSO messages from the parent
  useEffect(() => {
    // If already authenticated, skip the handshake flow entirely
    if (user || isLoading) return;
    if (bridge.status !== 'idle') return;

    const handler = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin)) return;
      const msg = parseParentMessage(event.data);
      if (!msg || msg.type !== 'PLUGIN_SSO') return;
      performHandshake(msg.payload);
    };

    window.addEventListener('message', handler);

    // Request the handshake from parent
    postToParent({ type: 'PLUGIN_SSO_REQUEST' });

    // Timeout if parent never responds
    const timer = window.setTimeout(() => {
      setBridge((prev) => (prev.status === 'idle' ? { status: 'timeout' } : prev));
    }, HANDSHAKE_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', handler);
      window.clearTimeout(timer);
    };
  }, [user, isLoading, bridge.status, performHandshake]);

  // Already authenticated from a previous session — render immediately
  if (user) {
    return <>{children}</>;
  }

  // AuthContext still validating stored token
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0E0C0A]">
        <div className="flex flex-col items-center gap-4">
          <LoadingAnimation size="md" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (bridge.status === 'idle' || bridge.status === 'handshaking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0E0C0A]">
        <div className="flex flex-col items-center gap-4 max-w-xs text-center px-6">
          <LoadingAnimation size="md" />
          <p className="text-gray-600 dark:text-gray-300 text-sm font-medium">
            {bridge.status === 'idle' ? 'Connecting to Smart AI…' : 'Verifying your account…'}
          </p>
          <p className="text-[11px] text-gray-400">Linking your host session</p>
        </div>
      </div>
    );
  }

  // Error / timeout → fall back to manual login
  const fallbackMessage =
    bridge.status === 'timeout'
      ? 'Automatic sign-in timed out. Please sign in manually to continue.'
      : bridge.status === 'error'
        ? `Automatic sign-in failed: ${bridge.message}`
        : 'Please sign in to continue.';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-[#0E0C0A]">
      <div className="mx-4 mt-4 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg shrink-0">
        <p className="text-xs text-amber-700 dark:text-amber-300">{fallbackMessage}</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        {authView === 'login' ? (
          <LoginPage onSwitchToSignup={() => setAuthView('signup')} />
        ) : (
          <SignupPage onSwitchToLogin={() => setAuthView('login')} />
        )}
      </div>
    </div>
  );
}
