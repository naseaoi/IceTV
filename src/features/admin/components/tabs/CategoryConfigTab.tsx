'use client';

import {
  type DragEndEvent,
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useEffect, useMemo, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import AdminSearchField from '@/features/admin/components/AdminSearchField';
import { CategoryAddForm } from '@/features/admin/components/tabs/category/CategoryAddForm';
import { CategoryEditForm } from '@/features/admin/components/tabs/category/CategoryEditForm';
import { SortableCategoryRow } from '@/features/admin/components/tabs/category/SortableCategoryRow';
import { useAdminSourceActions } from '@/features/admin/hooks/useAdminSourceActions';
import { useLoadingState } from '@/features/admin/hooks/useLoadingState';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { CustomCategory } from '@/features/admin/types/internal';
import {
  applyClientServerConfig,
  fetchClientServerConfig,
} from '@/lib/runtime-config';
import { getErrorMessage } from '@/lib/user-facing-error';
import { AdminConfig } from '@/types/admin';

const CategoryConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const { isLoading, withLoading } = useLoadingState();
  const { runAction } = useAdminSourceActions({
    endpoint: '/api/admin/category',
    refreshConfig,
    afterRefresh: async () => {
      applyClientServerConfig(await fetchClientServerConfig());
    },
  });
  const [categories, setCategories] = useState<CustomCategory[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const isFiltering = normalizedQuery.length > 0;
  const visibleRows = useMemo(
    () =>
      categories.filter((item) =>
        [item.name, item.query].some((value) =>
          value?.toLowerCase().includes(normalizedQuery),
        ),
      ),
    [categories, normalizedQuery],
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CustomCategory | null>(
    null,
  );
  const [editingIdentity, setEditingIdentity] = useState<{
    query: string;
    type: 'movie' | 'tv';
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomCategory | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newCategory, setNewCategory] = useState<CustomCategory>({
    name: '',
    type: 'movie',
    query: '',
    disabled: false,
    from: 'config',
  });

  const categoryTypeOptions = [
    { value: 'movie', label: '电影' },
    { value: 'tv', label: '电视剧' },
  ];

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.CustomCategories) {
      setCategories(config.CustomCategories);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callCategoryApi = async (body: Record<string, unknown>) => {
    setActionError('');
    await runAction({ ...body });
  };

  const handleToggleEnable = (category: CustomCategory) => {
    const action = category.disabled ? 'enable' : 'disable';
    withLoading(`toggleCategory_${category.query}_${category.type}`, () =>
      callCategoryApi({
        action,
        query: category.query,
        type: category.type,
      }),
    ).catch((error) => setActionError(getErrorMessage(error, '操作失败')));
  };

  const handleConfirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    withLoading(`deleteCategory_${target.query}_${target.type}`, () =>
      callCategoryApi({
        action: 'delete',
        query: target.query,
        type: target.type,
      }),
    ).catch((error) => setActionError(getErrorMessage(error, '操作失败')));
  };

  const handleOpenEdit = (category: CustomCategory) => {
    setEditingIdentity({ query: category.query, type: category.type });
    setEditingCategory({ ...category });
    setShowAddForm(false);
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
    setEditingIdentity(null);
  };

  const handleEditCategory = () => {
    if (!editingCategory?.name || !editingCategory.query || !editingIdentity) {
      return;
    }
    setFormError('');
    withLoading('editCategory', async () => {
      await callCategoryApi({
        action: 'edit',
        originalQuery: editingIdentity.query,
        originalType: editingIdentity.type,
        name: editingCategory.name,
        type: editingCategory.type,
        query: editingCategory.query,
      });
      handleCancelEdit();
    }).catch((error) => setFormError(getErrorMessage(error, '操作失败')));
  };

  const handleAddCategory = () => {
    if (!newCategory.name || !newCategory.query) return;
    setFormError('');
    withLoading('addCategory', async () => {
      await callCategoryApi({
        action: 'add',
        name: newCategory.name,
        type: newCategory.type,
        query: newCategory.query,
      });
      setNewCategory({
        name: '',
        type: 'movie',
        query: '',
        disabled: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch((error) => setFormError(getErrorMessage(error, '操作失败')));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (
      isLoading('saveCategoryOrder') ||
      isFiltering ||
      !over ||
      active.id === over.id
    )
      return;
    const oldIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === active.id,
    );
    const newIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === over.id,
    );
    setCategories((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = categories.map((c) => `${c.query}:${c.type}`);
    withLoading('saveCategoryOrder', () =>
      callCategoryApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch((error) => setActionError(getErrorMessage(error, '操作失败')));
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {actionError && (
        <p role='alert' className='text-sm text-red-600'>
          {actionError}
        </p>
      )}
      <div className='flex items-center justify-between gap-3'>
        <AdminSearchField
          value={filterQuery}
          onChange={setFilterQuery}
          label='搜索分类'
          className='min-w-0 flex-1 sm:w-72 sm:flex-none'
        />
        <div className='flex shrink-0 items-center'>
          <button
            onClick={() => {
              setFormError('');
              setShowAddForm(true);
              handleCancelEdit();
            }}
            className={buttonStyles.primary}
          >
            添加分类
          </button>
        </div>
      </div>

      <CategoryAddForm
        error={formError}
        newCategory={newCategory}
        isOpen={showAddForm}
        typeOptions={categoryTypeOptions}
        onChange={setNewCategory}
        onSubmit={handleAddCategory}
        onCancel={() => setShowAddForm(false)}
        isSubmitting={isLoading('addCategory')}
      />

      <CategoryEditForm
        error={formError}
        category={editingCategory}
        isOpen={!!editingCategory}
        typeOptions={categoryTypeOptions}
        onChange={setEditingCategory}
        onSubmit={handleEditCategory}
        onCancel={handleCancelEdit}
        isSubmitting={isLoading('editCategory')}
      />

      <div
        className='overflow-hidden rounded-xl ring-1 ring-gray-200 dark:ring-white/[0.06] [&:has([role=listbox])]:overflow-visible [&:has([role=menu])]:overflow-visible'
        data-list='category-list'
      >
        <div className='flex h-10 items-center gap-3 rounded-t-xl bg-gray-50 px-3 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400'>
          <span className='tabular-nums'>{`共 ${visibleRows.length} 个`}</span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={true}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext
            items={visibleRows.map((c) => `${c.query}:${c.type}`)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              aria-label='分类列表'
              className='divide-y divide-gray-200 dark:divide-white/[0.06]'
            >
              {visibleRows.length === 0 && (
                <li className='rounded-b-xl bg-white px-6 py-12 text-center text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400'>
                  {isFiltering ? '没有匹配的分类' : '暂无分类'}
                </li>
              )}
              {visibleRows.map((category) => (
                <SortableCategoryRow
                  isSortingDisabled={
                    isFiltering || isLoading('saveCategoryOrder')
                  }
                  key={`${category.query}:${category.type}`}
                  category={category}
                  isToggleLoading={isLoading(
                    `toggleCategory_${category.query}_${category.type}`,
                  )}
                  isDeleteLoading={isLoading(
                    `deleteCategory_${category.query}_${category.type}`,
                  )}
                  onToggleEnable={handleToggleEnable}
                  onEdit={handleOpenEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveCategoryOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveCategoryOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveCategoryOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 通用弹窗组件 */}

      <ConfirmModal
        isOpen={!!deleteTarget}
        title='确认删除分类'
        message={
          deleteTarget
            ? `确定要删除分类「${deleteTarget.name || deleteTarget.query}」吗？`
            : undefined
        }
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        confirmText='删除'
        danger
      />
    </div>
  );
};

export default CategoryConfig;
