'use client';

import { useState } from 'react';

import { useAlertModal } from '@/hooks/useAlertModal';
import { DataSource } from '@/features/admin/types/internal';

import type { SourceValidationStatus } from '@/features/admin/components/tabs/video-source/SortableSourceRow';

interface ValidationResult {
  key: string;
  name: string;
  status: 'valid' | 'no_results' | 'invalid' | 'validating';
  message: string;
  resultCount: number;
}

interface UseSourceValidationOptions {
  sources: DataSource[];
  showAlert: ReturnType<typeof useAlertModal>['showAlert'];
}

export function useSourceValidation({
  sources,
  showAlert,
}: UseSourceValidationOptions) {
  const [isValidating, setIsValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<
    ValidationResult[]
  >([]);

  const startValidation = async (searchKeyword: string, sourceKey?: string) => {
    if (!searchKeyword.trim()) {
      showAlert({
        type: 'warning',
        title: '请输入搜索关键词',
        message: '搜索关键词不能为空',
      });
      return;
    }

    const targetSource = sourceKey
      ? sources.find((source) => source.key === sourceKey)
      : null;
    if (sourceKey && !targetSource) {
      showAlert({
        type: 'error',
        title: '验证失败',
        message: '源不存在',
      });
      return;
    }

    setIsValidating(true);
    const targets = targetSource ? [targetSource] : sources;
    const initialResults: ValidationResult[] = targets.map((source) => ({
      key: source.key,
      name: source.name,
      status: 'validating',
      message: '检测中...',
      resultCount: 0,
    }));

    setValidationResults((prev) => {
      if (!sourceKey) {
        return initialResults;
      }

      const initialResult = initialResults[0];
      const exists = prev.some((result) => result.key === sourceKey);
      if (exists) {
        return prev.map((result) =>
          result.key === sourceKey ? initialResult : result,
        );
      }
      return [...prev, initialResult];
    });

    try {
      const params = new URLSearchParams({
        q: searchKeyword.trim(),
      });
      if (sourceKey) {
        params.set('source', sourceKey);
      }
      const eventSource = new EventSource(
        `/api/admin/source/validate?${params.toString()}`,
      );

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'start':
              break;

            case 'source_result':
            case 'source_error':
              setValidationResults((prev) => {
                const existing = prev.find((r) => r.key === data.source);
                const message =
                  data.status === 'valid'
                    ? '搜索正常'
                    : data.status === 'no_results'
                      ? '无法搜索到结果'
                      : '连接失败';
                const next: ValidationResult = {
                  key: data.source,
                  name:
                    sources.find((s) => s.key === data.source)?.name ||
                    data.source,
                  status: data.status,
                  message,
                  resultCount: data.status === 'valid' ? 1 : 0,
                };
                if (existing) {
                  return prev.map((r) => (r.key === data.source ? next : r));
                }
                return [...prev, next];
              });
              break;

            case 'complete':
              eventSource.close();
              setIsValidating(false);
              break;
          }
        } catch {
          eventSource.close();
          setIsValidating(false);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setIsValidating(false);
        showAlert({
          type: 'error',
          title: '验证失败',
          message: '连接错误，请重试',
        });
      };

      setTimeout(() => {
        if (eventSource.readyState === EventSource.OPEN) {
          eventSource.close();
          setIsValidating(false);
          showAlert({
            type: 'warning',
            title: '验证超时',
            message: '检测超时，请重试',
          });
        }
      }, 60000);
    } catch (error) {
      setIsValidating(false);
      showAlert({
        type: 'error',
        title: '验证失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
      throw error;
    }
  };

  const getValidationStatus = (
    sourceKey: string,
  ): SourceValidationStatus | null => {
    const result = validationResults.find((r) => r.key === sourceKey);
    if (!result) return null;

    switch (result.status) {
      case 'validating':
        return {
          text: '检测中',
          className:
            'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
          icon: '⟳',
          message: result.message,
        };
      case 'valid':
        return {
          text: '有效',
          className:
            'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
          icon: '✓',
          message: result.message,
        };
      case 'no_results':
        return {
          text: '无法搜索',
          className:
            'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
          icon: '⚠',
          message: result.message,
        };
      case 'invalid':
        return {
          text: '无效',
          className:
            'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
          icon: '✗',
          message: result.message,
        };
      default:
        return null;
    }
  };

  return {
    isValidating,
    startValidation,
    getValidationStatus,
  };
}
