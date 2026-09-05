import { useEffect, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { registerConfirmHost, type ConfirmRequest } from '../../lib/confirm';

/**
 * Single mount point for the promise-based confirmDialog() helper.
 * Mounted once in main.tsx next to the Toaster. Holds at most one
 * request; if a second arrives while one is open, the first resolves
 * false so no caller is left hanging.
 */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    registerConfirmHost((next) => {
      setReq((prev) => {
        if (prev && next) prev.resolve(false);
        return next;
      });
    });
    return () => registerConfirmHost(null);
  }, []);

  const settle = (ok: boolean) => {
    setReq((prev) => {
      prev?.resolve(ok);
      return null;
    });
  };

  return (
    <ConfirmDialog
      open={!!req}
      title={req?.title ?? 'Are you sure?'}
      description={req?.description ?? ''}
      confirmLabel={req?.confirmLabel ?? 'Confirm'}
      cancelLabel={req?.cancelLabel ?? 'Cancel'}
      destructive={req?.destructive ?? false}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
