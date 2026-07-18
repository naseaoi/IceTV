import { noSelectStyle, preventContextMenu } from './constants';

interface VideoCardTitleProps {
  title: string;
}

export function VideoCardTitle({ title }: VideoCardTitleProps) {
  return (
    <div
      data-video-card-title
      className='mt-2 text-center'
      style={noSelectStyle}
      onContextMenu={preventContextMenu}
    >
      <div className='relative' style={noSelectStyle}>
        <span
          className='peer block truncate text-sm font-semibold text-gray-900 transition-colors duration-300 ease-in-out group-hover:text-green-600 dark:text-gray-100 dark:group-hover:text-green-400'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          {title}
        </span>
        <div
          className='pointer-events-none invisible absolute bottom-full left-1/2 mb-2 -translate-x-1/2 transform whitespace-nowrap rounded-md bg-gray-800 px-3 py-1 text-xs text-white opacity-0 shadow-lg transition-all delay-100 duration-200 ease-out peer-hover:visible peer-hover:opacity-100'
          style={noSelectStyle}
          onContextMenu={preventContextMenu}
        >
          {title}
          <div
            className='absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 transform border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'
            style={noSelectStyle}
          ></div>
        </div>
      </div>
    </div>
  );
}
