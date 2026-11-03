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
      className={`skeleton-surface overflow-hidden ${className}`}
      {...props}
    >
      {active && <div className='skeleton-sweep' />}
    </div>
  );
});

const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div className={`relative w-full rounded-lg ${aspectRatio}`}>
    <ImageLoadingBackdrop className='absolute inset-0 rounded-lg' />
  </div>
);

export { ImageLoadingBackdrop, ImagePlaceholder };
