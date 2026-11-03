'use client';

import { useEffect, useState } from 'react';

// 浮层进出场：mounted 控制挂载，visible 驱动过渡类名；关闭时先撤 visible，过渡结束再卸载
export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // 双重 rAF：等隐藏态完成首帧绘制后再触发入场过渡
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          setVisible(true);
        });
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
      };
    }

    setVisible(false);
    const timeout = window.setTimeout(() => {
      setMounted(false);
    }, exitMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [open, exitMs]);

  return { mounted, visible };
}
