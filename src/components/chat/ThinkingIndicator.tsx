import { useState, useEffect, useRef } from 'react';

const PHRASES = [
  'Looking up relevant sections',
  'Searching through the Acts',
  'Pulling up the details',
  'Checking the latest provisions',
  'Going through the schedules',
  'Finding the right section',
  'Reading through the clauses',
  'Cross-referencing the rules',
  'Gathering the information',
  'Putting together your answer',
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
    <div className="flex items-center gap-3 py-3 px-1">
      <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
        <img src="/logoAI.png" alt="" className="w-5 h-5 object-contain" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-gray-500 dark:text-gray-400">{displayText}</span>
        <span className="inline-block w-0.5 h-4 bg-emerald-500 animate-pulse rounded-full" />
      </div>
    </div>
  );
}
