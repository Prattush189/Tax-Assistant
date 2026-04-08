import { motion, useAnimate } from 'motion/react';
import { useState, useEffect, useRef } from 'react';

const PHRASES = [
  'Analyzing your query',
  'Checking tax provisions',
  'Reviewing deductions',
  'Auditing the numbers',
  'Computing tax liability',
  'Verifying exemptions',
  'Consulting tax rules',
  'Calculating returns',
  'Processing assessment',
  'Evaluating compliance',
];

export function ThinkingIndicator() {
  const [scope, animate] = useAnimate();
  const logoRef = useRef(false);
  const [displayText, setDisplayText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const cancelRef = useRef(false);

  // Logo animation
  useEffect(() => {
    logoRef.current = false;

    const run = async () => {
      const el = scope.current?.querySelector('#logo-img') as HTMLElement;
      if (!el) return;

      while (!logoRef.current) {
        el.style.clipPath = 'inset(100% 0% 0% 0%)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0px)';

        await sleep(200);
        if (logoRef.current) break;

        await animate(el, { clipPath: 'inset(55% 0% 0% 0%)', transform: 'translateY(0px)' }, { duration: 0.45, ease: [0.22, 1.6, 0.36, 1] });
        await animate(el, { clipPath: 'inset(57% 0% 0% 0%)' }, { duration: 0.08 });
        await animate(el, { clipPath: 'inset(55% 0% 0% 0%)' }, { duration: 0.08 });

        await sleep(150);
        if (logoRef.current) break;

        await animate(el, { clipPath: 'inset(30% 0% 0% 0%)' }, { duration: 0.45, ease: [0.22, 1.6, 0.36, 1] });
        await animate(el, { clipPath: 'inset(32% 0% 0% 0%)' }, { duration: 0.08 });
        await animate(el, { clipPath: 'inset(30% 0% 0% 0%)' }, { duration: 0.08 });

        await sleep(150);
        if (logoRef.current) break;

        await animate(el, { clipPath: 'inset(0% 0% 0% 0%)', transform: 'translateY(-3px)' }, { duration: 0.55, ease: [0.16, 1, 0.3, 1] });
        await animate(el, { transform: 'translateY(0px)' }, { duration: 0.2, ease: 'easeOut' });

        await sleep(1000);
        if (logoRef.current) break;

        await animate(el, { opacity: '0', transform: 'translateY(5px)' }, { duration: 0.35, ease: 'easeIn' });
        await sleep(300);
      }
    };

    run();
    return () => { logoRef.current = true; };
  }, [animate, scope]);

  // Typing animation
  useEffect(() => {
    cancelRef.current = false;
    let charIndex = 0;
    let phase: 'typing' | 'hold' | 'erasing' = 'typing';
    const phrase = PHRASES[phraseIndex];

    const tick = () => {
      if (cancelRef.current) return;

      if (phase === 'typing') {
        charIndex++;
        setDisplayText(phrase.slice(0, charIndex));
        if (charIndex >= phrase.length) {
          phase = 'hold';
          setTimeout(tick, 1200);
        } else {
          setTimeout(tick, 40 + Math.random() * 30);
        }
      } else if (phase === 'hold') {
        phase = 'erasing';
        setTimeout(tick, 30);
      } else if (phase === 'erasing') {
        charIndex--;
        setDisplayText(phrase.slice(0, charIndex));
        if (charIndex <= 0) {
          setPhraseIndex(prev => (prev + 1) % PHRASES.length);
        } else {
          setTimeout(tick, 20);
        }
      }
    };

    const timer = setTimeout(tick, 300);
    return () => {
      cancelRef.current = true;
      clearTimeout(timer);
    };
  }, [phraseIndex]);

  return (
    <div className="flex items-start gap-3 py-4 px-2">
      <div ref={scope} className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#D4A020]/20 to-[#B8860B]/20 flex items-center justify-center shrink-0 overflow-hidden">
        <img
          id="logo-img"
          src="/logoAI.png"
          alt=""
          className="w-5 h-5 object-contain"
          style={{ clipPath: 'inset(100% 0% 0% 0%)' }}
          draggable={false}
        />
      </div>
      <div className="flex items-center gap-0 pt-1.5">
        <motion.span
          className="text-sm text-slate-500 dark:text-slate-400"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          {displayText}
          <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-[#D4A020] animate-pulse align-middle" />
        </motion.span>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
