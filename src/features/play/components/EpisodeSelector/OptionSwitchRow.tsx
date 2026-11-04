'use client';

export function OptionSwitchRow({
  label,
  description,
  checked,
  onChange,
  className = 'w-full px-3',
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      className={`flex items-center justify-between gap-3 rounded-lg py-2.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06] ${className}`}
      onClick={() => onChange(!checked)}
    >
      <span className='min-w-0'>
        <span className='block text-[13px] text-gray-700 dark:text-gray-200'>
          {label}
        </span>
        {description && (
          <span className='mt-0.5 block text-xs text-gray-400 dark:text-gray-500'>
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden='true'
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
  );
}
