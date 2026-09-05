/**
 * Promise-based confirm dialog.
 *
 * `window.confirm()` was used at 21 sites — an OS-native, unstyled,
 * un-themed box in an app that has its own ConfirmDialog. Converting a
 * synchronous `if (!confirm(...)) return;` into React state at every
 * site would mean 21 copies of open/close plumbing, so instead a single
 * <ConfirmHost /> mounted at the root owns the dialog and this helper
 * talks to it imperatively:
 *
 *   if (!(await confirmDialog({ title: 'Delete statement?', description: '…', destructive: true }))) return;
 *
 * Falls back to window.confirm if the host is not mounted (tests, an
 * early render) so a call can never silently resolve false.
 */
export interface ConfirmOptions {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Rose/danger palette on the confirm button. */
  destructive?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

type HostListener = (req: ConfirmRequest | null) => void;
let host: HostListener | null = null;

/** Called by <ConfirmHost /> on mount / unmount. */
export function registerConfirmHost(listener: HostListener | null): void {
  host = listener;
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o: ConfirmOptions = typeof opts === 'string' ? { description: opts } : opts;
  if (!host) {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(o.description));
  }
  const h = host;
  return new Promise<boolean>((resolve) => h({ ...o, resolve }));
}
