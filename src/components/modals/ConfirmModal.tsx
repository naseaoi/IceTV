'use client';

import { X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_DANGER_BUTTON_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import Spinner from '@/components/Spinner';

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
  onConfirm: () => void | Promise<void>;
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
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const close = onClose ?? onCancel ?? (() => {});
  const handleClose = () => {
    if (!pendingRef.current) close();
  };

  // 高级模式：有 children 时使用标题栏 + 关闭按钮布局
  if (children) {
    const defaultConfirmCls = danger
      ? MODAL_DANGER_BUTTON_CLASS
      : MODAL_PRIMARY_BUTTON_CLASS;
    const defaultCancelCls = MODAL_SECONDARY_BUTTON_CLASS;

    return (
      <ModalShell
        isOpen={isOpen}
        onClose={handleClose}
        panelClassName={containerClassName ?? 'max-w-2xl'}
      >
        <div className='p-5 sm:p-6'>
          <div className='mb-5 flex items-center justify-between gap-3'>
            <h3 className={MODAL_TITLE_CLASS}>{title}</h3>
            <button
              type='button'
              onClick={handleClose}
              aria-label='关闭'
              className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5`}
            >
              <X className='h-4 w-4' />
            </button>
          </div>

          <div className='mb-6'>{children}</div>

          <div className='flex justify-end gap-2'>
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

  const handleSimpleConfirm = () => {
    if (pendingRef.current || confirmDisabled) return;
    const result = onConfirm();
    if (!result || typeof result.then !== 'function') {
      handleClose();
      return;
    }
    pendingRef.current = true;
    setPending(true);
    void Promise.resolve(result).then(
      () => {
        pendingRef.current = false;
        setPending(false);
        close();
      },
      () => {
        pendingRef.current = false;
        setPending(false);
      },
    );
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleClose}
      panelClassName={containerClassName ?? 'max-w-sm'}
    >
      <div className='p-5 sm:p-6'>
        <h3 className={MODAL_TITLE_CLASS}>{title}</h3>
        {message && (
          <p className='mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400'>
            {message}
          </p>
        )}

        <div className='mt-6 flex justify-end gap-2'>
          <button
            type='button'
            onClick={handleClose}
            disabled={pending}
            className={cancelClassName ?? MODAL_SECONDARY_BUTTON_CLASS}
          >
            {cancelText}
          </button>
          <button
            type='button'
            onClick={handleSimpleConfirm}
            disabled={confirmDisabled || pending}
            aria-busy={pending}
            className={
              confirmClassName ??
              (danger ? MODAL_DANGER_BUTTON_CLASS : MODAL_PRIMARY_BUTTON_CLASS)
            }
          >
            {pending && <Spinner className='mr-2 inline-block h-4 w-4' />}
            {confirmText}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
