import { Heart } from 'lucide-react';
import type React from 'react';

interface FavoriteHeartButtonProps {
  favorited: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  iconClassName?: string;
  iconSize?: number;
  style?: React.CSSProperties;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
}

export function FavoriteHeartButton({
  favorited,
  onClick,
  className = '',
  iconClassName = '',
  iconSize = 20,
  style,
  onContextMenu,
}: FavoriteHeartButtonProps) {
  return (
    <button
      type='button'
      aria-label={favorited ? '取消收藏' : '收藏'}
      onClick={onClick}
      className={`inline-flex items-center justify-center transition-all duration-300 ease-out hover:scale-[1.1] ${className}`.trim()}
      style={style}
      onContextMenu={onContextMenu}
    >
      <Heart
        size={iconSize}
        className={`transition-colors duration-300 ease-out ${
          favorited
            ? 'fill-red-600 stroke-red-600'
            : 'fill-black/80 stroke-black/80 hover:fill-red-400 hover:stroke-red-400'
        } ${iconClassName}`.trim()}
      />
    </button>
  );
}
