import { useEffect, useState } from 'react';

import { parseCustomTimeFormat } from '@/features/live/lib/time';
import type { EpgData } from '@/features/live/types';

export function useLiveProgram(epgData: EpgData | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    const timer = window.setInterval(sync, 60_000);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  const programs = epgData?.programs || [];
  const currentIndex = programs.findIndex(
    (program) =>
      now >= parseCustomTimeFormat(program.start).getTime() &&
      now < parseCustomTimeFormat(program.end).getTime(),
  );
  return {
    now,
    currentIndex,
    current: programs[currentIndex],
    next: currentIndex >= 0 ? programs[currentIndex + 1] : undefined,
  };
}
