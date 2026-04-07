import { useState, ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isGuest, isLoading, continueAsGuest } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-orange-50 to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Allow through if authenticated OR guest
  if (isAuthenticated || isGuest) {
    return <>{children}</>;
  }

  if (authView === 'login') {
    return (
      <LoginPage
        onSwitchToSignup={() => setAuthView('signup')}
        onContinueAsGuest={continueAsGuest}
      />
    );
  }
  return <SignupPage onSwitchToLogin={() => setAuthView('login')} />;
}
