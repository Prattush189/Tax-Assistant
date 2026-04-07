import { motion, useAnimate } from 'motion/react';
import { useEffect, useRef } from 'react';

export function ThinkingIndicator() {
  const [scope, animate] = useAnimate();
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;

    const run = async () => {
      const el = scope.current?.querySelector('#logo-img') as HTMLElement;
      if (!el) return;

      while (!cancelRef.current) {
        // Reset — fully hidden
        el.style.clipPath = 'inset(100% 0% 0% 0%)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0px)';

        await sleep(200);
        if (cancelRef.current) break;

        // Stage 1: Back mountain rises — reveal bottom 45%
        await animate(
          el,
          { clipPath: 'inset(55% 0% 0% 0%)', transform: 'translateY(0px)' },
          { duration: 0.45, ease: [0.22, 1.6, 0.36, 1] } // spring overshoot
        );

        // Tiny settle
        await animate(
          el,
          { clipPath: 'inset(57% 0% 0% 0%)' },
          { duration: 0.08 }
        );
        await animate(
          el,
          { clipPath: 'inset(55% 0% 0% 0%)' },
          { duration: 0.08 }
        );

        await sleep(150);
        if (cancelRef.current) break;

        // Stage 2: Front mountain rises — reveal to 70%
        await animate(
          el,
          { clipPath: 'inset(30% 0% 0% 0%)' },
          { duration: 0.45, ease: [0.22, 1.6, 0.36, 1] }
        );

        // Settle
        await animate(
          el,
          { clipPath: 'inset(32% 0% 0% 0%)' },
          { duration: 0.08 }
        );
        await animate(
          el,
          { clipPath: 'inset(30% 0% 0% 0%)' },
          { duration: 0.08 }
        );

        await sleep(150);
        if (cancelRef.current) break;

        // Stage 3: Arrow flows to the sky — reveal fully + slight upward lift
        await animate(
          el,
          { clipPath: 'inset(0% 0% 0% 0%)', transform: 'translateY(-3px)' },
          { duration: 0.55, ease: [0.16, 1, 0.3, 1] }
        );

        // Settle back
        await animate(
          el,
          { transform: 'translateY(0px)' },
          { duration: 0.2, ease: 'easeOut' }
        );

        // Hold — full logo visible
        await sleep(1000);
        if (cancelRef.current) break;

        // Fade out
        await animate(
          el,
          { opacity: '0', transform: 'translateY(5px)' },
          { duration: 0.35, ease: 'easeIn' }
        );

        await sleep(300);
      }
    };

    run();

    return () => {
      cancelRef.current = true;
    };
  }, [animate, scope]);

  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex flex-col items-center gap-4">
        <div ref={scope} className="relative w-16 h-16">
          <img
            id="logo-img"
            src="/logoAI.png"
            alt="Thinking..."
            className="w-16 h-16 object-contain"
            style={{ clipPath: 'inset(100% 0% 0% 0%)' }}
            draggable={false}
          />
        </div>

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

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
