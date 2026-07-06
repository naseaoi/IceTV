'use client';

import { AlertTriangle } from 'lucide-react';
import { type ReactNode } from 'react';

import ModalShell from '@/components/modals/ModalShell';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  /** 简单模式：纯文本消息（会显示居中图标布局） */
  message?: string;
  /** 高级模式：自定义内容（会显示标题栏+关闭按钮布局） */
  children?: ReactNode;
  /** 关闭/取消回调 */
  onClose?: () => void;
  /** onClose 的别名，向后兼容 */
  onCancel?: () => void;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（简单模式下确认按钮变红） */
  danger?: boolean;
  /** 禁用确认按钮 */
  confirmDisabled?: boolean;
  /** 自定义确认按钮样式（覆盖默认） */
  confirmClassName?: string;
  /** 自定义取消按钮样式（覆盖默认） */
  cancelClassName?: string;
  /** 自定义弹窗容器宽度 */
  containerClassName?: string;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  children,
  onClose,
  onCancel,
  onConfirm,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  confirmDisabled = false,
  confirmClassName,
  cancelClassName,
  containerClassName,
}: ConfirmModalProps) {
  const handleClose = onClose ?? onCancel ?? (() => {});

  // 高级模式：有 children 时使用标题栏 + 关闭按钮布局
  if (children) {
    const defaultConfirmCls =
      'px-6 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors';
    const defaultCancelCls =
      'px-6 py-2.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors';

    return (
      <ModalShell
        isOpen={isOpen}
        onClose={handleClose}
        panelClassName={containerClassName ?? 'max-w-2xl'}
      >
        <div className='p-6'>
          <div className='mb-6 flex items-center justify-between'>
            <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
              {title}
            </h3>
            <button
              onClick={handleClose}
              className='text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300'
            >
              <svg
                className='h-6 w-6'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          </div>

          <div className='mb-6'>{children}</div>

          <div className='flex justify-end space-x-3'>
            <button
              onClick={handleClose}
              className={cancelClassName ?? defaultCancelCls}
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={confirmDisabled}
              className={confirmClassName ?? defaultConfirmCls}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  // 简单模式：纯文本 message + 居中图标布局
  // 点击确认后立即关闭弹窗，操作在后台执行
  const defaultConfirmSimple = danger
    ? 'bg-rose-600 hover:bg-rose-500'
    : 'bg-blue-600 hover:bg-blue-500';

  const handleSimpleConfirm = () => {
    handleClose();
    onConfirm();
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleClose}
      panelClassName={containerClassName ?? 'max-w-md'}
    >
      <div className='p-6 sm:p-7'>
        <div className='text-center'>
          <span className='mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300'>
            <AlertTriangle className='h-5 w-5' />
          </span>
          <h3 className='mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
          {message && (
            <p className='mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300'>
              {message}
            </p>
          )}
        </div>

        <div className='mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <button
            onClick={handleClose}
            className={
              cancelClassName ??
              'rounded-xl border border-gray-200/70 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100/70 dark:border-white/10 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:bg-white/[0.06]'
            }
          >
            {cancelText}
          </button>
          <button
            onClick={handleSimpleConfirm}
            disabled={confirmDisabled}
            className={
              confirmClassName ??
              `rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors ${defaultConfirmSimple}`
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
