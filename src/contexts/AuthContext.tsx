import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro' | 'enterprise';
  /** Grants ITR tab access independently of admin role. */
  itr_enabled?: boolean;
}

export interface SignupResult {
  /** Set when the backend requires email OTP verification before issuing JWTs. */
  needsEmailVerification?: boolean;
  /** Pre-normalized email the user should enter their code for. */
  email?: string;
}

export interface LoginResult {
  /** Set when login is blocked pending email verification (password-based only). */
  needsEmailVerification?: boolean;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Accepts email OR phone as the identifier. Returns a hint when the user
   *  still needs to verify their email — callers should route to the OTP page. */
  login: (identifier: string, password: string) => Promise<LoginResult>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  loginWithSso: (accessToken: string, refreshToken: string, user: User) => void;
  /** Returns `{ needsEmailVerification: true, email }` instead of setting the
   *  user — a JWT is only issued after POST /api/auth/verify-email succeeds. */
  signup: (name: string, email: string, password: string) => Promise<SignupResult>;
  /** Called by VerifyEmailPage after the server returns tokens. */
  completeEmailVerification: (accessToken: string, refreshToken: string, user: User) => void;
  logout: () => void;
  getAuthHeader: () => Record<string, string>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'tax_access_token';
const REFRESH_KEY = 'tax_refresh_token';

async function apiFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Preserve server-provided metadata (e.g. needsEmailVerification) on the error
    const err = new Error(data.error || 'Request failed') as Error & Record<string, unknown>;
    for (const k of Object.keys(data ?? {})) {
      if (k !== 'error') err[k] = data[k];
    }
    throw err;
  }
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setUser(null);
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;

    try {
      const data = await apiFetch('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(REFRESH_KEY, data.refreshToken);
      return data.accessToken;
    } catch {
      logout();
      return null;
    }
  }, [logout]);

  const fetchMe = useCallback(async (token: string): Promise<User | null> => {
    try {
      return await apiFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    async function validate() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) { setIsLoading(false); return; }

      let userData = await fetchMe(token);
      if (!userData) {
        const newToken = await refreshAccessToken();
        if (newToken) userData = await fetchMe(newToken);
      }
      if (userData) setUser(userData);
      else logout();
      setIsLoading(false);
    }
    validate();
  }, [refreshAccessToken, logout, fetchMe]);

  const login = async (identifier: string, password: string): Promise<LoginResult> => {
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(REFRESH_KEY, data.refreshToken);
      setUser(data.user);
      return {};
    } catch (err) {
      const e = err as Error & { needsEmailVerification?: boolean; email?: string };
      if (e.needsEmailVerification) {
        return { needsEmailVerification: true, email: e.email ?? identifier };
      }
      throw err;
    }
  };

  const loginWithGoogle = async (code: string) => {
    const data = await apiFetch('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    setUser(data.user);
  };

  /** Plugin SSO — tokens already issued by POST /api/auth/plugin-sso, just persist + set user */
  const loginWithSso = useCallback((accessToken: string, refreshToken: string, ssoUser: User) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    setUser(ssoUser);
  }, []);

  const signup = async (name: string, email: string, password: string): Promise<SignupResult> => {
    const data = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    if (data.needsEmailVerification) {
      // No tokens yet — caller routes to VerifyEmailPage
      return { needsEmailVerification: true, email: data.email ?? email.toLowerCase().trim() };
    }
    // Legacy path (should not happen after server rollout, but handles dev fallback)
    if (data.accessToken && data.refreshToken && data.user) {
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(REFRESH_KEY, data.refreshToken);
      setUser(data.user);
    }
    return {};
  };

  /** Persists JWTs + user from a successful /verify-email response. */
  const completeEmailVerification = useCallback(
    (accessToken: string, refreshToken: string, verifiedUser: User) => {
      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem(REFRESH_KEY, refreshToken);
      setUser(verifiedUser);
    },
    [],
  );

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      const userData = await fetchMe(token);
      if (userData) setUser(userData);
    }
  }, [fetchMe]);

  const getAuthHeader = useCallback((): Record<string, string> => {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginWithGoogle,
        loginWithSso,
        signup,
        completeEmailVerification,
        logout,
        getAuthHeader,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
