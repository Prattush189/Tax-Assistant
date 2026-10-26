// App-level view switching for components that sit too deep to receive
// App's navigateTo as a prop (e.g. ProLock inside a calculator tab, a deed
// wizard's upgrade link). The app has no URL router — views are App state —
// so links like `/plan` or `#plan` just reloaded the current view.

const EVENT = 'app:navigate';

export function requestNavigate(view: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: view }));
}

/** Subscribes App to navigation requests; returns the unsubscribe. */
export function onNavigateRequest(handler: (view: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
