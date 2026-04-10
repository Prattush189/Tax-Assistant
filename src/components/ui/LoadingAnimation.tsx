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
 * Uses /loading.gif from the public folder.
 */
export function LoadingAnimation({ size = 'md', className }: LoadingAnimationProps) {
  return (
    <img
      src="/loading.gif"
      alt="Loading"
      className={cn('object-contain pointer-events-none select-none', sizeMap[size], className)}
      draggable={false}
    />
  );
}
