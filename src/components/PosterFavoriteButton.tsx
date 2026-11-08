import type React from 'react';

import { FavoriteHeartButton } from '@/components/FavoriteHeartButton';
import {
  noSelectStyle,
  preventContextMenu,
} from '@/components/video-card/constants';

interface PosterFavoriteButtonProps {
  favorited: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}

// 海报右下角的悬停收藏按钮；隐藏时同时关闭命中，避免触屏点到看不见的按钮
export default function PosterFavoriteButton({
  favorited,
  onClick,
}: PosterFavoriteButtonProps) {
  return (
    <div
      data-button='true'
      className='pointer-events-none absolute bottom-2 right-2 opacity-0 transition-opacity duration-200 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100'
      style={noSelectStyle}
      onContextMenu={preventContextMenu}
    >
      <FavoriteHeartButton
        favorited={favorited}
        onClick={onClick}
        iconSize={16}
        className='h-8 w-8 rounded-full bg-black/70 shadow-sm'
        unfavoritedIconClassName='fill-transparent stroke-white hover:fill-red-400 hover:stroke-red-400'
        style={noSelectStyle}
        onContextMenu={preventContextMenu}
      />
    </div>
  );
}
