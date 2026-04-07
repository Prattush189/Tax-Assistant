import { motion } from 'motion/react';

export function ThinkingIndicator() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex flex-col items-center gap-3">
        <svg
          width="56"
          height="56"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Bar 1 (shorter, left) — rises first */}
          <motion.path
            d="M20 75 L20 55 L35 50 L35 75 Z"
            fill="#B8860B"
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{
              duration: 0.5,
              ease: 'easeOut',
              repeat: Infinity,
              repeatDelay: 1.8,
              repeatType: 'loop',
            }}
            style={{ originY: '100%', originX: '50%', transformBox: 'fill-box' }}
          />

          {/* Bar 2 (taller, right) — rises second */}
          <motion.path
            d="M36 75 L36 40 L51 35 L51 75 Z"
            fill="#D4A020"
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{
              duration: 0.5,
              ease: 'easeOut',
              delay: 0.3,
              repeat: Infinity,
              repeatDelay: 1.8,
              repeatType: 'loop',
            }}
            style={{ originY: '100%', originX: '50%', transformBox: 'fill-box' }}
          />

          {/* Arrow — shoots up last */}
          <motion.path
            d="M42 42 L55 15 L75 10 L68 22 L80 20 L52 38 Z"
            fill="#E0B830"
            initial={{ y: 30, opacity: 0, scale: 0.5 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{
              duration: 0.6,
              ease: [0.34, 1.56, 0.64, 1], // spring-like overshoot
              delay: 0.7,
              repeat: Infinity,
              repeatDelay: 1.5,
              repeatType: 'loop',
            }}
          />

          {/* Subtle shine sweep on the arrow */}
          <motion.path
            d="M55 15 L60 12 L70 19 L68 22 Z"
            fill="#F5E6B8"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.6, 0] }}
            transition={{
              duration: 0.8,
              delay: 1.1,
              repeat: Infinity,
              repeatDelay: 1.8,
              repeatType: 'loop',
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
