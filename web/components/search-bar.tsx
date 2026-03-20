import * as React from 'react';
import { cn } from '../utils/cn';

interface SearchBarProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
}

const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(
  ({ className, placeholder = 'Search...', ...props }, ref) => (
    <div className={cn('relative', className)}>
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-6 w-6 text-text-dim pointer-events-none"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={ref}
        type="search"
        placeholder={placeholder}
        className="h-9 w-full bg-input-bg text-text rounded-[6px] pl-11 pr-4 text-[17px] tracking-[-0.17px] outline-none placeholder:text-text-dim transition-colors"
        {...props}
      />
    </div>
  ),
);

SearchBar.displayName = 'SearchBar';

export { SearchBar };
export type { SearchBarProps };
