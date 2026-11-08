import { type ReactNode, useId } from 'react';

// 不裁切溢出，行内下拉菜单要能伸出外框；需要贴边底色的子元素自行加圆角
export const ADMIN_PANEL_CLASS =
  'rounded-xl bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-white/[0.06]';

interface AdminSettingsGroupProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

// 设置分组：标题在框外，框内各行以细线分隔，与后台列表共用同一外框
export function AdminSettingsGroup({
  title,
  actions,
  children,
  className = '',
}: AdminSettingsGroupProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={className}
    >
      {(title || actions) && (
        <div className='mb-3 flex min-h-8 items-center justify-between gap-3'>
          {title && (
            <h2
              id={headingId}
              className='text-base font-semibold text-gray-900 dark:text-gray-100'
            >
              {title}
            </h2>
          )}
          {actions && (
            <div className='ml-auto flex shrink-0 items-center gap-2'>
              {actions}
            </div>
          )}
        </div>
      )}
      <div
        className={`${ADMIN_PANEL_CLASS} divide-y divide-gray-200 dark:divide-white/[0.06]`}
      >
        {children}
      </div>
    </section>
  );
}

interface AdminSettingRowProps {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  // 与标题同行的短状态或链接（测试结果、致谢），窄屏自动换到标题下方
  labelAddon?: ReactNode;
  children?: ReactNode;
  // inline：开关等窄控件始终与标签同行；stacked：控件独占一行，适合多行文本、长输入框
  layout?: 'responsive' | 'inline' | 'stacked';
}

const ROW_LAYOUT_CLASS = {
  responsive: 'flex-col sm:flex-row sm:items-center sm:justify-between',
  inline: 'items-center justify-between',
  stacked: 'flex-col',
};

const LABEL_CLASS = 'text-sm font-medium text-gray-900 dark:text-gray-100';

export function AdminSettingRow({
  label,
  htmlFor,
  description,
  labelAddon,
  children,
  layout = 'responsive',
}: AdminSettingRowProps) {
  const LabelTag = htmlFor ? 'label' : 'p';

  return (
    <div
      className={`flex gap-x-6 gap-y-2.5 px-4 py-3.5 ${ROW_LAYOUT_CLASS[layout]}`}
    >
      <div className={layout === 'stacked' ? 'min-w-0' : 'min-w-0 flex-1'}>
        {labelAddon ? (
          <div className='flex flex-wrap items-center gap-x-3 gap-y-0.5'>
            <LabelTag htmlFor={htmlFor} className={LABEL_CLASS}>
              {label}
            </LabelTag>
            {labelAddon}
          </div>
        ) : (
          <LabelTag htmlFor={htmlFor} className={`block ${LABEL_CLASS}`}>
            {label}
          </LabelTag>
        )}
        {description && (
          <div className='mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400'>
            {description}
          </div>
        )}
      </div>
      {children && (
        <div
          className={
            layout === 'stacked'
              ? 'min-w-0'
              : 'flex min-w-0 shrink-0 items-center gap-2 sm:max-w-[60%] sm:justify-end'
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}
