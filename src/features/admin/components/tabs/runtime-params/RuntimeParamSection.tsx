import { RotateCcw } from 'lucide-react';

import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import type { RuntimeParamGroup } from '@/features/admin/lib/runtime-param-fields';
import {
  type RuntimeParamSettings,
  DEFAULT_RUNTIME_PARAMS,
  RUNTIME_PARAM_RANGES,
} from '@/lib/runtime-params';

export function RuntimeParamSection({
  group,
  values,
  onChange,
  status,
}: {
  group: RuntimeParamGroup;
  values: RuntimeParamSettings;
  onChange: (key: keyof RuntimeParamSettings, value: number) => void;
  status?: string;
}) {
  return (
    <AdminSettingsGroup
      title={group.title}
      actions={
        status && (
          <span className='rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'>
            {status}
          </span>
        )
      }
    >
      {group.fields.map((field) => {
        const inputId = `runtime-param-${field.key}`;
        const hintId = `${inputId}-hint`;
        const range = RUNTIME_PARAM_RANGES[field.key];
        const defaultValue = DEFAULT_RUNTIME_PARAMS[field.key];
        const isDefault = values[field.key] === defaultValue;

        return (
          <AdminSettingRow
            key={field.key}
            label={field.label}
            htmlFor={inputId}
            description={field.hint && <span id={hintId}>{field.hint}</span>}
          >
            <div className='flex h-9 w-32 items-center rounded-lg bg-white ring-1 ring-inset ring-gray-200 transition focus-within:ring-2 focus-within:ring-brand-500 has-[:invalid]:ring-red-400 dark:bg-gray-900 dark:ring-gray-700 dark:has-[:invalid]:ring-red-500/70'>
              <input
                id={inputId}
                name={field.key}
                type='number'
                inputMode='numeric'
                min={range.min}
                max={range.max}
                step={1}
                required
                aria-describedby={field.hint ? hintId : undefined}
                value={values[field.key]}
                onChange={(event) =>
                  onChange(field.key, Number(event.target.value))
                }
                className='h-full min-w-0 flex-1 border-0 bg-transparent py-0 pl-3 pr-1 text-right text-sm tabular-nums text-gray-900 [appearance:textfield] focus:outline-none focus:ring-0 dark:text-gray-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
              />
              <span className='w-8 shrink-0 pr-3 text-xs text-gray-500 dark:text-gray-400'>
                {field.unit}
              </span>
            </div>
            <button
              type='button'
              onClick={() => onChange(field.key, defaultValue)}
              aria-label={`${field.label}恢复默认值 ${defaultValue}`}
              title={`恢复默认值 ${defaultValue}`}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-gray-200 ${
                isDefault ? 'invisible' : ''
              }`}
            >
              <RotateCcw aria-hidden='true' className='h-3.5 w-3.5' />
            </button>
          </AdminSettingRow>
        );
      })}
    </AdminSettingsGroup>
  );
}
