interface SkeletonTextProps {
  // 传入与真实文字相同的字号、行高与间距类，行高度随之同步
  className?: string;
  barClassName?: string;
}

// 零宽字符撑出一行行高，骨架高度不再手写像素值
export const SKELETON_TEXT_STRUT = String.fromCharCode(0x200b);

export default function SkeletonText({
  className = '',
  barClassName = 'h-3.5 w-3/4 rounded',
}: SkeletonTextProps) {
  return (
    <div aria-hidden='true' className={`flex items-center ${className}`}>
      {SKELETON_TEXT_STRUT}
      <div className={`skeleton ${barClassName}`} />
    </div>
  );
}
