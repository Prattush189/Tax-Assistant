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
  const [displayText, setDisplayText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const cancelRef = useRef(false);

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
    <div className="flex items-center gap-2 py-3 px-2">
      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#D4A020]/20 to-[#B8860B]/20 flex items-center justify-center shrink-0">
        <img src="/logoAI.png" alt="" className="w-4 h-4 object-contain" />
      </div>
      <span className="text-sm text-slate-500 dark:text-slate-400">
        {displayText}
      </span>
      <span className="inline-block w-0.5 h-3.5 bg-[#D4A020] animate-pulse" />
    </div>
  );
}
