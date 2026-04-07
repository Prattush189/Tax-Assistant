import { motion } from 'motion/react';

// Stylized logo: 2 rising bars + flowing arrow — matches logoAI shape
export function ThinkingIndicator() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex flex-col items-center gap-4">
        <svg width="64" height="64" viewBox="0 0 120 120" fill="none">
          {/* ── Bar 1 (shorter, left) ── */}
          <motion.g
            initial={{ scaleY: 0 }}
            animate={{ scaleY: [0, 1.15, 0.95, 1] }}
            transition={{
              duration: 0.6,
              ease: [0.22, 1.36, 0.36, 1], // spring bounce
              repeat: Infinity,
              repeatDelay: 2.2,
            }}
            style={{ originY: '100%', transformBox: 'fill-box' }}
          >
            {/* Front face */}
            <path d="M18 95 L18 62 L38 55 L38 95 Z" fill="#B8860B" />
            {/* Top face */}
            <path d="M18 62 L28 56 L48 49 L38 55 Z" fill="#E8C44A" />
            {/* Side face */}
            <path d="M38 55 L48 49 L48 88 L38 95 Z" fill="#D4A020" />
          </motion.g>

          {/* ── Bar 2 (taller, right) ── */}
          <motion.g
            initial={{ scaleY: 0 }}
            animate={{ scaleY: [0, 1.12, 0.96, 1] }}
            transition={{
              duration: 0.6,
              delay: 0.25,
              ease: [0.22, 1.36, 0.36, 1],
              repeat: Infinity,
              repeatDelay: 2.2,
            }}
            style={{ originY: '100%', transformBox: 'fill-box' }}
          >
            {/* Front face */}
            <path d="M42 95 L42 45 L62 38 L62 95 Z" fill="#C8960E" />
            {/* Top face */}
            <path d="M42 45 L52 39 L72 32 L62 38 Z" fill="#EFD06C" />
            {/* Side face */}
            <path d="M62 38 L72 32 L72 88 L62 95 Z" fill="#D4A020" />
          </motion.g>

          {/* ── Arrow (traces its path upward) ── */}
          {/* Arrow body — stroke draws, then fills */}
          <motion.path
            d="M52 52 L68 28 L80 16"
            stroke="#E8C44A"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{
              pathLength: [0, 0, 1, 1, 1, 0],
              opacity: [0, 0, 1, 1, 1, 0],
            }}
            transition={{
              duration: 2.8,
              ease: 'easeInOut',
              times: [0, 0.28, 0.55, 0.75, 0.85, 1],
              repeat: Infinity,
              repeatDelay: 0,
            }}
          />

          {/* Arrowhead */}
          <motion.polygon
            points="80,8 92,14 78,24"
            fill="#EFD06C"
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: [0, 0, 0, 1.3, 1, 1, 0],
              opacity: [0, 0, 0, 1, 1, 1, 0],
            }}
            transition={{
              duration: 2.8,
              ease: [0.22, 1.36, 0.36, 1],
              times: [0, 0.28, 0.45, 0.58, 0.65, 0.85, 1],
              repeat: Infinity,
              repeatDelay: 0,
            }}
            style={{ originX: '85%', originY: '50%', transformBox: 'fill-box' }}
          />

          {/* Arrow trail sparkle */}
          <motion.circle
            cx="80"
            cy="16"
            r="3"
            fill="#FFF5D4"
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: [0, 0, 0, 0, 2, 0],
              opacity: [0, 0, 0, 0, 0.8, 0],
            }}
            transition={{
              duration: 2.8,
              times: [0, 0.28, 0.45, 0.58, 0.68, 0.8],
              repeat: Infinity,
              repeatDelay: 0,
            }}
          />
        </svg>

        {/* Thinking text */}
        <motion.p
          className="text-xs font-medium text-[#B8860B] dark:text-[#D4A020]"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          Thinking...
        </motion.p>
      </div>
    </div>
  );
}
