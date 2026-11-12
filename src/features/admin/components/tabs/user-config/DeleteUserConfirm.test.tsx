import { fireEvent, render, screen } from '@testing-library/react';

import { DeleteUserConfirm } from '@/features/admin/components/tabs/user-config/DeleteUserConfirm';

it('删除提交期间禁用重复提交与关闭，失败保留对话框和就地错误', () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const { rerender } = render(
    <DeleteUserConfirm
      isOpen
      username='demo'
      isDeleting={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
  rerender(
    <DeleteUserConfirm
      isOpen
      username='demo'
      isDeleting
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByRole('button', { name: '删除中...' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '删除中...' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
  rerender(
    <DeleteUserConfirm
      isOpen
      username='demo'
      isDeleting={false}
      error='删除失败'
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('删除失败');
  expect(screen.getByRole('button', { name: '确认删除' })).not.toBeDisabled();
});
