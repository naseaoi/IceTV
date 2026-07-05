import React from 'react';

interface TabBarProps<K extends string> {
  tabs: { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
}

export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
}: TabBarProps<K>) {
  return (
    <div className='flex flex-shrink-0 border-b border-gray-200/80 dark:border-white/10'>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`relative min-h-[64px] flex-1 py-[18px] text-center text-sm font-medium transition-all duration-200
            ${
              active === tab.key
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }
          `.trim()}
        >
          {tab.label}
          {active === tab.key && (
            <div className='absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-green-500 dark:bg-green-400' />
          )}
        </button>
      ))}
    </div>
  );
}
