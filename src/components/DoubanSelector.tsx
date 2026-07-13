'use client';

import React from 'react';

import {
  CapsuleSelector,
  useCapsuleIndicator,
  useSyncIndicator,
} from './CapsuleSelector';
import MultiLevelSelector from './MultiLevelSelector';
import WeekdaySelector from './WeekdaySelector';

interface SelectorOption {
  label: string;
  value: string;
}

interface DoubanSelectorProps {
  type: 'movie' | 'tv' | 'show' | 'anime';
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  onMultiLevelChange?: (values: Record<string, string>) => void;
  onWeekdayChange: (weekday: string) => void;
}

// 电影选项
const moviePrimaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '热门电影', value: '热门' },
  { label: '最新电影', value: '最新' },
  { label: '豆瓣高分', value: '豆瓣高分' },
  { label: '冷门佳片', value: '冷门佳片' },
];
const movieSecondaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '华语', value: '华语' },
  { label: '欧美', value: '欧美' },
  { label: '韩国', value: '韩国' },
  { label: '日本', value: '日本' },
];

// 电视剧选项
const tvPrimaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '最近热门', value: '最近热门' },
];
const tvSecondaryOptions: SelectorOption[] = [
  { label: '全部', value: 'tv' },
  { label: '国产', value: 'tv_domestic' },
  { label: '欧美', value: 'tv_american' },
  { label: '日本', value: 'tv_japanese' },
  { label: '韩国', value: 'tv_korean' },
  { label: '动漫', value: 'tv_animation' },
  { label: '纪录片', value: 'tv_documentary' },
];

// 综艺选项
const showPrimaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '最近热门', value: '最近热门' },
];
const showSecondaryOptions: SelectorOption[] = [
  { label: '全部', value: 'show' },
  { label: '国内', value: 'show_domestic' },
  { label: '国外', value: 'show_foreign' },
];

// 动漫选项
const animePrimaryOptions: SelectorOption[] = [
  { label: '每日放送', value: '每日放送' },
  { label: '番剧', value: '番剧' },
  { label: '剧场版', value: '剧场版' },
];

// 按 type 获取对应的选项配置
export const doubanSelectorOptionsMap: Record<
  string,
  {
    primary: SelectorOption[];
    secondary: SelectorOption[];
    primaryDefault: string;
    secondaryDefault: string;
  }
> = {
  movie: {
    primary: moviePrimaryOptions,
    secondary: movieSecondaryOptions,
    primaryDefault: moviePrimaryOptions[0].value,
    secondaryDefault: movieSecondaryOptions[0].value,
  },
  tv: {
    primary: tvPrimaryOptions,
    secondary: tvSecondaryOptions,
    primaryDefault: tvPrimaryOptions[1].value,
    secondaryDefault: tvSecondaryOptions[0].value,
  },
  anime: {
    primary: animePrimaryOptions,
    secondary: [],
    primaryDefault: animePrimaryOptions[0].value,
    secondaryDefault: '',
  },
  show: {
    primary: showPrimaryOptions,
    secondary: showSecondaryOptions,
    primaryDefault: showPrimaryOptions[1].value,
    secondaryDefault: showSecondaryOptions[0].value,
  },
};

const fallbackOpts = {
  primary: [] as SelectorOption[],
  secondary: [] as SelectorOption[],
  primaryDefault: '',
  secondaryDefault: '',
};

const DoubanSelector: React.FC<DoubanSelectorProps> = ({
  type,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
  onMultiLevelChange,
  onWeekdayChange,
}) => {
  const opts = doubanSelectorOptionsMap[type] || fallbackOpts;

  const primary = useCapsuleIndicator();
  const secondary = useCapsuleIndicator();

  useSyncIndicator(
    opts.primary,
    primarySelection,
    opts.primaryDefault,
    primary.updatePosition,
  );
  useSyncIndicator(
    opts.secondary,
    secondarySelection,
    opts.secondaryDefault,
    secondary.updatePosition,
  );

  const handleMultiLevelChange = (values: Record<string, string>) => {
    onMultiLevelChange?.(values);
  };

  return (
    <div className='space-y-4 sm:space-y-6'>
      {/* 电影类型 */}
      {type === 'movie' && (
        <div className='space-y-3 sm:space-y-4'>
          <div className='overflow-x-auto'>
            <CapsuleSelector
              options={moviePrimaryOptions}
              activeValue={primarySelection || moviePrimaryOptions[0].value}
              onChange={onPrimaryChange}
              containerRef={primary.containerRef}
              buttonRefs={primary.buttonRefs}
              indicatorStyle={primary.indicatorStyle}
            />
          </div>
          {primarySelection !== '全部' ? (
            <div className='overflow-x-auto'>
              <CapsuleSelector
                options={movieSecondaryOptions}
                activeValue={
                  secondarySelection || movieSecondaryOptions[0].value
                }
                onChange={onSecondaryChange}
                containerRef={secondary.containerRef}
                buttonRefs={secondary.buttonRefs}
                indicatorStyle={secondary.indicatorStyle}
              />
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <MultiLevelSelector
                key={`${type}-${primarySelection}`}
                onChange={handleMultiLevelChange}
                contentType={type}
              />
            </div>
          )}
        </div>
      )}

      {/* 电视剧类型 */}
      {type === 'tv' && (
        <div className='space-y-3 sm:space-y-4'>
          <div className='overflow-x-auto'>
            <CapsuleSelector
              options={tvPrimaryOptions}
              activeValue={primarySelection || tvPrimaryOptions[1].value}
              onChange={onPrimaryChange}
              containerRef={primary.containerRef}
              buttonRefs={primary.buttonRefs}
              indicatorStyle={primary.indicatorStyle}
            />
          </div>
          {(primarySelection || tvPrimaryOptions[1].value) === '最近热门' ? (
            <div className='overflow-x-auto'>
              <CapsuleSelector
                options={tvSecondaryOptions}
                activeValue={secondarySelection || tvSecondaryOptions[0].value}
                onChange={onSecondaryChange}
                containerRef={secondary.containerRef}
                buttonRefs={secondary.buttonRefs}
                indicatorStyle={secondary.indicatorStyle}
              />
            </div>
          ) : (primarySelection || tvPrimaryOptions[1].value) === '全部' ? (
            <div className='overflow-x-auto'>
              <MultiLevelSelector
                key={`${type}-${primarySelection}`}
                onChange={handleMultiLevelChange}
                contentType={type}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* 动漫类型 */}
      {type === 'anime' && (
        <div className='space-y-3 sm:space-y-4'>
          <div className='overflow-x-auto'>
            <CapsuleSelector
              options={animePrimaryOptions}
              activeValue={primarySelection || animePrimaryOptions[0].value}
              onChange={onPrimaryChange}
              containerRef={primary.containerRef}
              buttonRefs={primary.buttonRefs}
              indicatorStyle={primary.indicatorStyle}
            />
          </div>
          {(primarySelection || animePrimaryOptions[0].value) === '每日放送' ? (
            <div className='overflow-x-auto'>
              <WeekdaySelector onWeekdayChange={onWeekdayChange} />
            </div>
          ) : (
            <div className='overflow-x-auto'>
              {(primarySelection || animePrimaryOptions[0].value) === '番剧' ? (
                <MultiLevelSelector
                  key={`anime-tv-${primarySelection}`}
                  onChange={handleMultiLevelChange}
                  contentType='anime-tv'
                />
              ) : (
                <MultiLevelSelector
                  key={`anime-movie-${primarySelection}`}
                  onChange={handleMultiLevelChange}
                  contentType='anime-movie'
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* 综艺类型 */}
      {type === 'show' && (
        <div className='space-y-3 sm:space-y-4'>
          <div className='overflow-x-auto'>
            <CapsuleSelector
              options={showPrimaryOptions}
              activeValue={primarySelection || showPrimaryOptions[1].value}
              onChange={onPrimaryChange}
              containerRef={primary.containerRef}
              buttonRefs={primary.buttonRefs}
              indicatorStyle={primary.indicatorStyle}
            />
          </div>
          {(primarySelection || showPrimaryOptions[1].value) === '最近热门' ? (
            <div className='overflow-x-auto'>
              <CapsuleSelector
                options={showSecondaryOptions}
                activeValue={
                  secondarySelection || showSecondaryOptions[0].value
                }
                onChange={onSecondaryChange}
                containerRef={secondary.containerRef}
                buttonRefs={secondary.buttonRefs}
                indicatorStyle={secondary.indicatorStyle}
              />
            </div>
          ) : (primarySelection || showPrimaryOptions[1].value) === '全部' ? (
            <div className='overflow-x-auto'>
              <MultiLevelSelector
                key={`${type}-${primarySelection}`}
                onChange={handleMultiLevelChange}
                contentType={type}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default DoubanSelector;
