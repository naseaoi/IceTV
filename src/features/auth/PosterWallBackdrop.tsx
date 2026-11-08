'use client';

const COVER_COUNT = 16;
const COLUMNS = 12;
const COVERS_PER_COLUMN = 8;
// 列内步长 5 与封面数互质；列间偏移 8 让相邻两列各取一半封面、互不重复
const COL_OFFSET_STEP = 8;
const ROW_STRIDE = 5;
// 窄屏旋转后只露出中间 8 列，两侧对称隐藏不改变其余列位置
const NARROW_HIDDEN_EDGE_COLUMNS = 2;

const COVERS = Array.from(
  { length: COVER_COUNT },
  (_, i) => `/login-posters/photo${String(i + 1).padStart(2, '0')}.webp`,
);

function columnCovers(column: number): string[] {
  return Array.from(
    { length: COVERS_PER_COLUMN },
    (_, i) => COVERS[(column * COL_OFFSET_STEP + i * ROW_STRIDE) % COVER_COUNT],
  );
}

export function PosterWallBackdrop() {
  return (
    <div
      aria-hidden
      className='pointer-events-none absolute inset-0 animate-fade-in overflow-hidden'
    >
      <div className='poster-wall absolute left-1/2 top-1/2 flex gap-3 sm:gap-4'>
        {Array.from({ length: COLUMNS }, (_, column) => {
          const covers = columnCovers(column);
          const narrowHidden =
            column < NARROW_HIDDEN_EDGE_COLUMNS ||
            column >= COLUMNS - NARROW_HIDDEN_EDGE_COLUMNS;
          return (
            <div
              key={column}
              className={`poster-column w-28 shrink-0 flex-col sm:w-36 xl:w-44 [@media(min-width:2200px)]:w-52 ${
                narrowHidden ? 'hidden sm:flex' : 'flex'
              } ${column % 2 === 1 ? 'poster-column-reverse' : ''}`}
              style={{
                animationDuration: `${110 + (column % 3) * 18}s`,
                animationDelay: `${-column * 23}s`,
              }}
            >
              {[...covers, ...covers].map((src, index) => (
                <div
                  key={index}
                  className='relative mb-3 aspect-[2/3] w-full overflow-hidden rounded-lg bg-white/[0.06] sm:mb-4'
                >
                  <img
                    src={src}
                    alt=''
                    decoding='async'
                    className='absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-700'
                    ref={(el) => {
                      if (el?.complete) el.style.opacity = '1';
                    }}
                    onLoad={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
