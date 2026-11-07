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
    id: 0,
  });
  if (state.value !== value) {
    setState({ value, previous: state.value, id: state.id + 1 });
  }

  const direction =
    state.previous !== null && state.value < state.previous ? 'down' : 'up';
  const id = state.id;

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
