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

// 隐形等宽数字撑出与真实数字相同的宽度，数字出现时同行文字不左右跳动；
// className 传入与真实数字相同的字号、字重与 tabular-nums
export function SkeletonNumber({
  digits = 1,
  className = '',
}: {
  digits?: number;
  className?: string;
}) {
  return (
    <span aria-hidden='true' className={`relative inline-block ${className}`}>
      <span className='invisible'>{'0'.repeat(Math.max(1, digits))}</span>
      <span className='skeleton absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2 rounded' />
    </span>
  );
}
