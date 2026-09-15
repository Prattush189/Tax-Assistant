import { cn } from '../../lib/utils';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface LoadingAnimationProps {
  size?: Size;
  className?: string;
}

const sizeMap: Record<Size, string> = {
  xs: 'w-4 h-4',      // inline with text
  sm: 'w-6 h-6',      // buttons, small inline
  md: 'w-10 h-10',    // default — chat avatar, default loader
  lg: 'w-16 h-16',    // modal loaders
  xl: 'w-24 h-24',    // large centered loaders
  '2xl': 'w-32 h-32', // hero / full-screen loaders
};

/**
 * Looped animated logo for all loading states.
 * /loading.webp is 128px wide — 2x DPR for the largest size in use (lg,
 * 64px). It first loads the moment a chat is sent, sharing the connection
 * with the answer stream, so keep it small: the old 1.35 MB GIF held a
 * reply back ~20 s on a mobile link after each deploy re-validated it.
 */
export function LoadingAnimation({ size = 'md', className }: LoadingAnimationProps) {
  return (
    <img
      src="/loading.webp"
      alt="Loading"
      className={cn('object-contain pointer-events-none select-none', sizeMap[size], className)}
      draggable={false}
    />
  );
}
