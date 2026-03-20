import { cn } from '../utils/cn';
import type { ReactNode } from 'react';

interface NavHeaderProps {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

function NavHeader({ title, left, right, className }: NavHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between px-3 py-3.5 bg-surface rounded-[6px]', className)}>
      <div className="flex items-center gap-2 shrink-0 w-6">{left}</div>
      <span className="text-[17px] tracking-[-0.17px] font-normal text-accent text-center flex-1">
        {title}
      </span>
      <div className="flex items-center gap-2 justify-end shrink-0 w-6">{right}</div>
    </div>
  );
}

export { NavHeader };
export type { NavHeaderProps };
