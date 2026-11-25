'use client';

import {
  libraryChipClass,
  LibraryFilterChip,
} from '@/components/LibraryToolbar';

export function ListPillSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; count?: number | null }[];
  value: T;
  onChange?: (value: T) => void;
}) {
  return (
    <div role='group' aria-label={label} className='flex gap-2'>
      {options.map((option) =>
        option.count === undefined ? (
          <button
            key={option.value}
            type='button'
            aria-pressed={value === option.value}
            onClick={() => onChange?.(option.value)}
            className={libraryChipClass(value === option.value)}
          >
            {option.label}
          </button>
        ) : (
          <LibraryFilterChip
            key={option.value}
            label={option.label}
            count={option.count ?? 0}
            loading={option.count === null}
            active={value === option.value}
            onClick={() => onChange?.(option.value)}
          />
        ),
      )}
    </div>
  );
}
