'use client';

import { useState } from 'react';

interface AnimatedCountProps {
  value: number;
  format?: (value: number) => string;
  className?: string;
}

interface CountState {
  value: number;
  previous: number | null;
  // 方向随变化一起记录，旧值滚出结束后清空 previous 不能改变新值的动画类
  direction: 'up' | 'down';
  id: number;
}

// 数值变化时旧值沿变化方向滚出、新值滚入；首次渲染不播放
export default function AnimatedCount({
  value,
  format = String,
  className = '',
}: AnimatedCountProps) {
  const [state, setState] = useState<CountState>({
    value,
    previous: null,
    direction: 'up',
    id: 0,
  });
  if (state.value !== value) {
    setState({
      value,
      previous: state.value,
      direction: value < state.value ? 'down' : 'up',
      id: state.id + 1,
    });
  }

  const { direction, id } = state;

  return (
    <span className={`count-roll ${className}`.trim()}>
      {state.previous !== null && (
        <span
          key={`out-${id}`}
          aria-hidden='true'
          className={`count-roll-out-${direction}`}
          onAnimationEnd={() =>
            setState((current) =>
              current.id === id ? { ...current, previous: null } : current,
            )
          }
        >
          {format(state.previous)}
        </span>
      )}
      <span
        key={`in-${id}`}
        className={id > 0 ? `count-roll-in-${direction}` : undefined}
      >
        {format(state.value)}
      </span>
    </span>
  );
}
