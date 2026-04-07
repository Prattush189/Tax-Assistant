import { motion, useAnimate } from 'motion/react';
import { useEffect } from 'react';

export function ThinkingIndicator() {
  const [scope, animate] = useAnimate();

  useEffect(() => {
    // Sequential animation loop
    const runAnimation = async () => {
      while (true) {
        // Reset
        await animate(scope.current, { opacity: 1 }, { duration: 0 });

        // Phase 1: Bars rise — reveal bottom 60% of logo (the two bars)
        await animate(
          '#logo-reveal',
          { clipPath: 'inset(40% 0 0 0)' },
          { duration: 0.6, ease: [0.34, 1.56, 0.64, 1] } // spring overshoot
        );

        // Small settle bounce
        await animate(
          '#logo-reveal',
          { clipPath: 'inset(42% 0 0 0)' },
          { duration: 0.1 }
        );
        await animate(
          '#logo-reveal',
          { clipPath: 'inset(40% 0 0 0)' },
          { duration: 0.1 }
        );

        // Phase 2: Arrow flows up — reveal remaining top
        await animate(
          '#logo-reveal',
          { clipPath: 'inset(0% 0 0 0)' },
          { duration: 0.7, ease: [0.16, 1, 0.3, 1] } // smooth decelerate
        );

        // Phase 3: Glow pulse
        animate(
          '#logo-glow',
          { opacity: [0, 0.6, 0], scale: [1, 1.4, 1.6] },
          { duration: 0.8, ease: 'easeOut' }
        );

        // Hold
        await new Promise(r => setTimeout(r, 1200));

        // Phase 4: Fade out and reset
        await animate(
          '#logo-reveal',
          { clipPath: 'inset(100% 0 0 0)' },
          { duration: 0.4, ease: 'easeIn' }
        );

        // Brief pause before loop
        await new Promise(r => setTimeout(r, 300));
      }
    };

    runAnimation();
  }, [animate, scope]);

  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex flex-col items-center gap-4">
        <div ref={scope} className="relative w-16 h-16">
          {/* Glow ring behind logo */}
          <motion.div
            id="logo-glow"
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(212,160,32,0.4) 0%, transparent 70%)',
              opacity: 0,
            }}
          />

          {/* Logo with clip-path reveal */}
          <div
            id="logo-reveal"
            className="absolute inset-0"
            style={{ clipPath: 'inset(100% 0 0 0)' }}
          >
            <img
              src="/logoAI.png"
              alt="Thinking..."
              className="w-16 h-16 object-contain"
              draggable={false}
            />
          </div>
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
