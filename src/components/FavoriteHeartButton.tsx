'use client';

import { Heart } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

interface FavoriteHeartButtonProps {
  favorited: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  iconClassName?: string;
  unfavoritedIconClassName?: string;
  iconSize?: number;
  style?: React.CSSProperties;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
}

// 点击后这段时间内收藏状态翻转才算本次操作的结果（含取消收藏的确认弹窗），异步加载或其他页面同步不播放动效
const CLICK_FEEDBACK_WINDOW_MS = 30000;

const PARTICLE_COLORS = [
  'rgb(244 63 94)',
  'rgb(251 113 133)',
  'rgb(239 68 68)',
  'rgb(251 146 60)',
];

const PARTICLES = Array.from({ length: 10 }, (_, index) => {
  const outer = index % 2 === 0;
  return {
    angle: index * 36 + (outer ? 0 : 18),
    reach: outer ? 1 : 0.72,
    size: outer ? 0.2 : 0.14,
    color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
  };
});

type Feedback = { kind: 'like' | 'unlike'; id: number };

export function FavoriteHeartButton({
  favorited,
  onClick,
  className = '',
  iconClassName = '',
  unfavoritedIconClassName = 'fill-black/80 stroke-black/80 hover:fill-red-400 hover:stroke-red-400',
  iconSize = 20,
  style,
  onContextMenu,
}: FavoriteHeartButtonProps) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const clickedAtRef = useRef(0);
  const previousRef = useRef(favorited);

  useEffect(() => {
    if (previousRef.current === favorited) return;
    previousRef.current = favorited;
    if (Date.now() - clickedAtRef.current > CLICK_FEEDBACK_WINDOW_MS) return;
    clickedAtRef.current = 0;
    setFeedback((current) => ({
      kind: favorited ? 'like' : 'unlike',
      id: (current?.id ?? 0) + 1,
    }));
  }, [favorited]);

  const burstDistance = Math.round(iconSize * 0.95);

  return (
    <button
      type='button'
      aria-label={favorited ? '取消收藏' : '收藏'}
      onClick={(event) => {
        clickedAtRef.current = Date.now();
        onClick(event);
      }}
      className={`inline-flex items-center justify-center transition-transform duration-300 ease-out hover:scale-[1.1] ${className}`.trim()}
      style={style}
      onContextMenu={onContextMenu}
    >
      <span className='relative inline-flex'>
        {feedback?.kind === 'like' && (
          <span
            key={`burst-${feedback.id}`}
            aria-hidden='true'
            className='pointer-events-none absolute inset-0'
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget.lastElementChild) {
                setFeedback(null);
              }
            }}
          >
            <span className='heart-ring' />
            {PARTICLES.map((particle) => (
              <span
                key={particle.angle}
                className='heart-particle'
                style={
                  {
                    '--particle-angle': `${particle.angle}deg`,
                    '--particle-distance': `${Math.round(burstDistance * particle.reach)}px`,
                    '--particle-size': `${Math.max(2, Math.round(iconSize * particle.size))}px`,
                    '--particle-color': particle.color,
                  } as React.CSSProperties
                }
              />
            ))}
          </span>
        )}
        <Heart
          key={`heart-${feedback?.id ?? 0}`}
          size={iconSize}
          className={`relative transition-colors duration-300 ease-out ${
            favorited ? 'fill-red-600 stroke-red-600' : unfavoritedIconClassName
          } ${
            feedback
              ? feedback.kind === 'like'
                ? 'heart-like'
                : 'heart-unlike'
              : ''
          } ${iconClassName}`.trim()}
        />
      </span>
    </button>
  );
}
