import { doubanSelectorOptionsMap } from '@/components/DoubanSelector';
import type { CustomCategory } from '@/features/douban/hooks/useDoubanFeed';

const WEEKDAY_LABELS: Record<string, string> = {
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六',
  Sun: '周日',
};

export function getDoubanFilterSummary({
  type,
  primarySelection,
  secondarySelection,
  selectedWeekday,
  customCategories,
}: {
  type: string;
  primarySelection: string;
  secondarySelection: string;
  selectedWeekday: string;
  customCategories: CustomCategory[];
}): string {
  if (type === 'custom') {
    const primaryLabel =
      primarySelection === 'movie'
        ? '电影'
        : primarySelection === 'tv'
          ? '剧集'
          : primarySelection;
    const matched = customCategories.find(
      (cat) =>
        cat.type === primarySelection && cat.query === secondarySelection,
    );
    return [primaryLabel, matched?.name || secondarySelection]
      .filter(Boolean)
      .join(' · ');
  }

  const opts = doubanSelectorOptionsMap[type];
  const primaryLabel =
    opts?.primary.find((option) => option.value === primarySelection)?.label ||
    primarySelection;

  if (type === 'anime') {
    const weekdayLabel =
      primarySelection === '每日放送'
        ? WEEKDAY_LABELS[selectedWeekday] || ''
        : '';
    return [primaryLabel, weekdayLabel].filter(Boolean).join(' · ');
  }

  const secondaryLabel =
    opts?.secondary.find((option) => option.value === secondarySelection)
      ?.label || secondarySelection;
  return [primaryLabel, secondaryLabel].filter(Boolean).join(' · ');
}
