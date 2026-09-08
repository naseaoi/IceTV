import { inputStyles } from '@/features/admin/lib/buttonStyles';
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
  const headingId = `runtime-group-${group.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className='self-start overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/60'
    >
      <div className='border-b border-gray-200 px-4 py-3 dark:border-gray-700'>
        <div className='flex items-center justify-between gap-3'>
          <h3
            id={headingId}
            className='text-sm font-medium text-gray-900 dark:text-gray-100'
          >
            {group.title}
          </h3>
          {status && (
            <span className='text-xs text-gray-500 dark:text-gray-400'>
              {status}
            </span>
          )}
        </div>
      </div>
      <div className='divide-y divide-gray-100 dark:divide-gray-700/60'>
        {group.fields.map((field) => {
          const inputId = `runtime-param-${field.key}`;
          const rangeId = `${inputId}-range`;
          const hintId = `${inputId}-hint`;
          const range = RUNTIME_PARAM_RANGES[field.key];

          return (
            <div
              key={field.key}
              className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3'
            >
              <div className='min-w-0 flex-1 basis-40'>
                <label
                  htmlFor={inputId}
                  className='text-sm font-medium text-gray-700 dark:text-gray-300'
                >
                  {field.label}
                </label>
                {field.hint && (
                  <p
                    id={hintId}
                    className='mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400'
                  >
                    {field.hint}
                  </p>
                )}
              </div>
              <div className='ml-auto flex shrink-0 items-center gap-2'>
                <span
                  id={rangeId}
                  className='text-right text-xs leading-relaxed text-gray-500 dark:text-gray-400'
                >
                  <span className='block whitespace-nowrap'>
                    {range.min}–{range.max}
                  </span>
                  <span className='block whitespace-nowrap'>
                    默认 {DEFAULT_RUNTIME_PARAMS[field.key]}
                  </span>
                </span>
                <input
                  id={inputId}
                  name={field.key}
                  type='number'
                  min={range.min}
                  max={range.max}
                  step={1}
                  required
                  aria-describedby={
                    field.hint ? `${rangeId} ${hintId}` : rangeId
                  }
                  value={values[field.key]}
                  onChange={(event) =>
                    onChange(field.key, Number(event.target.value))
                  }
                  className={`${inputStyles.withFocus} w-24 text-right text-sm`}
                />
                <span className='w-4 text-xs text-gray-500 dark:text-gray-400'>
                  {field.unit}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
