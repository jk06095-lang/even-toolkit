import { cn } from '../utils/cn';
import type { ReactNode } from 'react';

interface NavHeaderProps {
  title: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

function NavHeader({ title, left, right, className }: NavHeaderProps) {
  return (
    <div className={cn('flex items-center w-full box-border px-3 h-[52px] bg-surface rounded-b-[6px]', className)}>
      {left ? (
        <div className="flex items-center gap-2 shrink-0 min-w-[40px] mr-2">{left}</div>
      ) : null}
      <div className="flex flex-1 min-w-0 items-center justify-center">
        {typeof title === 'string'
          ? (
              <span className="block w-full truncate text-[17px] tracking-[-0.17px] font-normal text-text text-center">
                {title}
              </span>
            )
          : (
              <div className="w-full min-w-0">
                {title}
              </div>
            )}
      </div>
      {right ? (
        <div className="flex items-center gap-2 justify-end shrink-0 min-w-[40px] ml-2">{right}</div>
      ) : null}
    </div>
  );
}

export { NavHeader };
export type { NavHeaderProps };
