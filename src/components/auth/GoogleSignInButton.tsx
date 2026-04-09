import { useState } from 'react';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { useAuth } from '../../contexts/AuthContext';

interface GoogleSignInButtonProps {
  onError?: (msg: string) => void;
}

export function GoogleSignInButton({ onError }: GoogleSignInButtonProps) {
  const { loginWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleSuccess = async (response: CredentialResponse) => {
    if (!response.credential) {
      onError?.('No credential received from Google');
      return;
    }

    setIsLoading(true);
    try {
      await loginWithGoogle(response.credential);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full flex justify-center py-3">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full flex justify-center [&>div]:w-full">
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={() => onError?.('Google sign-in was cancelled')}
        theme="outline"
        size="large"
        width="400"
        text="signin_with"
        shape="rectangular"
      />
    </div>
  );
}
