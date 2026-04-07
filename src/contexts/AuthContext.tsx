import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  getAuthHeader: () => Record<string, string>;
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
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

  // Try to refresh the access token
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

  // Validate stored token on mount
  useEffect(() => {
    async function validate() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const data = await apiFetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(data);
      } catch {
        // Token expired — try refresh
        const newToken = await refreshAccessToken();
        if (newToken) {
          try {
            const data = await apiFetch('/api/auth/me', {
              headers: { Authorization: `Bearer ${newToken}` },
            });
            setUser(data);
          } catch {
            logout();
          }
        }
      } finally {
        setIsLoading(false);
      }
    }
    validate();
  }, [refreshAccessToken, logout]);

  const login = async (email: string, password: string) => {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    setUser(data.user);
  };

  const signup = async (name: string, email: string, password: string) => {
    const data = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    setUser(data.user);
  };

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
        signup,
        logout,
        getAuthHeader,
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
