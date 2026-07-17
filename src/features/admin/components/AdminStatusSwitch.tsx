interface AdminStatusSwitchProps {
  enabled: boolean;
  isLoading: boolean;
  ariaLabel: string;
  onToggle: () => void;
}

export function AdminStatusSwitch({
  enabled,
  isLoading,
  ariaLabel,
  onToggle,
}: AdminStatusSwitchProps) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={enabled}
      aria-label={ariaLabel}
      onClick={onToggle}
      disabled={isLoading}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
        enabled
          ? 'bg-green-500 dark:bg-green-600'
          : 'bg-gray-300 dark:bg-gray-600'
      } ${isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      title={enabled ? '点击禁用' : '点击启用'}
    >
      <span
        aria-hidden='true'
        className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
