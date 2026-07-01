const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div
    className={`relative w-full overflow-hidden rounded-lg bg-gray-200/60 dark:bg-gray-700/60 ${aspectRatio}`}
  >
    <div className='via-white/8 absolute inset-0 animate-shimmer bg-gradient-to-r from-white/0 to-white/0 dark:from-white/0 dark:via-white/5 dark:to-white/0' />
  </div>
);

export { ImagePlaceholder };
