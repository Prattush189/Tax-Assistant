import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './contexts/AuthContext';
import { Toaster } from 'react-hot-toast';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            borderRadius: '12px',
            background: 'var(--toast-bg, #fff)',
            color: 'var(--toast-color, #1e293b)',
            border: '1px solid var(--toast-border, #e2e8f0)',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
          },
        }}
      />
    </AuthProvider>
  </StrictMode>,
);
