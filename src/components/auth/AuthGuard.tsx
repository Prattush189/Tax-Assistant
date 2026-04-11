import { useState, ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { LoadingAnimation } from '../ui/LoadingAnimation';

interface AuthGuardProps {
  children: ReactNode;
}

type AuthView = 'login' | 'signup' | 'verify' | 'forgot';

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const [authView, setAuthView] = useState<AuthView>('login');
  const [pendingEmail, setPendingEmail] = useState('');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0E0C0A]">
        <div className="flex flex-col items-center gap-4">
          <LoadingAnimation size="md" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (authView === 'verify') {
      return (
        <VerifyEmailPage
          email={pendingEmail}
          onBack={() => setAuthView('login')}
          onVerified={() => {
            /* AuthContext state update triggers re-render into the app */
          }}
        />
      );
    }
    if (authView === 'forgot') {
      return (
        <ForgotPasswordPage
          initialEmail={pendingEmail}
          onBack={() => setAuthView('login')}
          onDone={() => {
            /* AuthContext state update triggers re-render into the app */
          }}
        />
      );
    }
    if (authView === 'login') {
      return (
        <LoginPage
          onSwitchToSignup={() => setAuthView('signup')}
          onNeedsVerification={(email) => {
            setPendingEmail(email);
            setAuthView('verify');
          }}
          onForgotPassword={(email) => {
            setPendingEmail(email);
            setAuthView('forgot');
          }}
        />
      );
    }
    return (
      <SignupPage
        onSwitchToLogin={() => setAuthView('login')}
        onNeedsVerification={(email) => {
          setPendingEmail(email);
          setAuthView('verify');
        }}
      />
    );
  }

  return <>{children}</>;
}
