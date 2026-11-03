import React, { useEffect, useRef, useState } from 'react';

import RatingStars from '@/components/RatingStars';
import {
  formatRating,
  normalizeRating,
  RATING_MAX,
  RATING_MIN,
} from '@/lib/rating';

interface RatingInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

// 指针拖动按 0.5 分吸附，精细到 0.1 靠键盘或直接输入分数
const POINTER_SNAP = 0.5;

export function ratingFromPointerOffset(offset: number, width: number): number {
  const ratio = width > 0 ? offset / width : 0;
  const raw = Math.ceil((ratio * RATING_MAX) / POINTER_SNAP) * POINTER_SNAP;
  return normalizeRating(raw);
}

function ratingFromPointer(event: React.PointerEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  return ratingFromPointerOffset(event.clientX - rect.left, rect.width);
}

function parseRatingText(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return normalizeRating(parsed);
}

export function RatingInput({ value, onChange, disabled }: RatingInputProps) {
  const [previewValue, setPreviewValue] = useState<number | null>(null);
  const [text, setText] = useState(value === null ? '' : formatRating(value));
  const draggingRef = useRef(false);

  useEffect(() => {
    setText(value === null ? '' : formatRating(value));
  }, [value]);

  const commitText = () => {
    const parsed = parseRatingText(text);
    if (parsed === undefined) {
      setText(value === null ? '' : formatRating(value));
      return;
    }
    onChange(parsed);
    setText(parsed === null ? '' : formatRating(parsed));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 0.1;
    const current = value ?? 0;
    let next: number | null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = normalizeRating(current + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next =
          current - step < RATING_MIN ? null : normalizeRating(current - step);
        break;
      case 'Home':
        next = RATING_MIN;
        break;
      case 'End':
        next = RATING_MAX;
        break;
      case 'Backspace':
      case 'Delete':
        next = null;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(next);
  };

  const shown = previewValue ?? value;

  return (
    <div className='flex items-center gap-3'>
      <label className='group relative flex h-12 w-[4.5rem] shrink-0 items-baseline justify-center rounded-xl bg-amber-500/10 px-2 pt-2.5 ring-1 ring-inset ring-amber-500/25 transition focus-within:ring-2 focus-within:ring-amber-500/60'>
        <span className='sr-only'>分数（1.0–10.0）</span>
        <input
          type='text'
          inputMode='decimal'
          value={text}
          disabled={disabled}
          placeholder='—'
          maxLength={4}
          className='w-full border-0 bg-transparent p-0 text-center text-2xl font-semibold tabular-nums leading-none text-amber-600 outline-none placeholder:text-amber-600/40 focus:ring-0 disabled:opacity-60 dark:text-amber-400 dark:placeholder:text-amber-400/40'
          onChange={(event) => setText(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitText();
            }
          }}
        />
      </label>

      <div
        role='slider'
        tabIndex={disabled ? -1 : 0}
        aria-label='评分'
        aria-valuemin={RATING_MIN}
        aria-valuemax={RATING_MAX}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? '未评分' : `${formatRating(value)} 分`}
        aria-disabled={disabled || undefined}
        className={`touch-none select-none rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
        onKeyDown={disabled ? undefined : handleKeyDown}
        onPointerDown={(event) => {
          if (disabled) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setPreviewValue(ratingFromPointer(event));
        }}
        onPointerMove={(event) => {
          if (disabled) return;
          if (event.pointerType === 'touch' && !draggingRef.current) return;
          setPreviewValue(ratingFromPointer(event));
        }}
        onPointerUp={(event) => {
          if (disabled || !draggingRef.current) return;
          draggingRef.current = false;
          setPreviewValue(null);
          onChange(ratingFromPointer(event));
        }}
        onPointerLeave={() => {
          if (!draggingRef.current) setPreviewValue(null);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setPreviewValue(null);
        }}
      >
        <RatingStars value={shown} size='lg' decorative />
      </div>
    </div>
  );
}
