const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div
    className={`flex w-full items-center justify-center rounded-lg bg-gray-200/60 dark:bg-gray-700/60 ${aspectRatio}`}
  >
    <div className='h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-gray-600 dark:border-t-gray-400' />
  </div>
);

export { ImagePlaceholder };
