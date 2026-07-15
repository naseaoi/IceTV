import { type ComponentPropsWithoutRef, forwardRef } from 'react';

const ImageLoadingBackdrop = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'> & { active?: boolean }
>(function ImageLoadingBackdrop(
  { active = true, className = '', ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`overflow-hidden bg-gray-200/70 dark:bg-gray-700/60 ${className}`}
      {...props}
    >
      {active && (
        <div className='dark:via-white/12 absolute inset-0 animate-shimmer bg-gradient-to-r from-white/0 via-white/20 to-white/0' />
      )}
    </div>
  );
});

const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div className={`relative w-full rounded-lg ${aspectRatio}`}>
    <ImageLoadingBackdrop className='absolute inset-0 rounded-lg' />
  </div>
);

export { ImageLoadingBackdrop, ImagePlaceholder };
