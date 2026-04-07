import { motion } from 'motion/react';

export function ThinkingIndicator() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-14 h-14">
          {/* Pulse rings */}
          <motion.div
            className="absolute inset-0 rounded-full bg-[#D4A020]/15"
            animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-0 rounded-full bg-[#D4A020]/10"
            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
          />

          {/* Logo with clip-path reveal: bottom → top, then loops */}
          <motion.div
            className="absolute inset-0 overflow-hidden"
            animate={{
              clipPath: [
                'inset(100% 0 0 0)',  // fully hidden (clipped from top)
                'inset(60% 0 0 0)',   // bars start appearing
                'inset(30% 0 0 0)',   // bars fully visible
                'inset(0% 0 0 0)',    // arrow revealed
                'inset(0% 0 0 0)',    // hold
                'inset(100% 0 0 0)',  // reset
              ],
            }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, 0.2, 0.45, 0.65, 0.85, 1],
            }}
          >
            <img
              src="/logoAI.svg"
              alt="Thinking..."
              className="w-14 h-14 object-contain"
            />
          </motion.div>

          {/* Subtle upward motion on the logo */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            animate={{ y: [4, 0, 0, -2, 0, 4] }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, 0.2, 0.45, 0.65, 0.85, 1],
            }}
          >
            <div className="w-14 h-14" style={{ opacity: 0 }} />
          </motion.div>
        </div>

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
