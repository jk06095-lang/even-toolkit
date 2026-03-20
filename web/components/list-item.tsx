import { cn } from '../utils/cn';
import { useRef, useState, useCallback } from 'react';
import type { ReactNode, TouchEvent as ReactTouchEvent, MouseEvent as ReactMouseEvent } from 'react';

interface ListItemProps {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onDelete?: () => void;
  className?: string;
}

const SWIPE_THRESHOLD = 80;
const DELETE_WIDTH = 72;

function ListItem({ title, subtitle, leading, trailing, onPress, onDelete, className }: ListItemProps) {
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const currentOffset = useRef(0);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    if (!onDelete) return;
    startX.current = e.touches[0].clientX;
    currentOffset.current = offset;
    setSwiping(true);
  }, [onDelete, offset]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX.current;
    const next = Math.min(0, Math.max(-DELETE_WIDTH, currentOffset.current + dx));
    setOffset(next);
  }, [swiping]);

  const onTouchEnd = useCallback(() => {
    if (!swiping) return;
    setSwiping(false);
    setOffset(offset < -SWIPE_THRESHOLD / 2 ? -DELETE_WIDTH : 0);
  }, [swiping, offset]);

  const Comp = onPress ? 'button' : 'div';

  return (
    <div className="relative overflow-hidden">
      {/* Delete action behind — only visible when swiped */}
      {onDelete && offset < 0 && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-negative text-text-highlight cursor-pointer"
          style={{ width: DELETE_WIDTH }}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
      {/* Foreground item */}
      <Comp
        type={onPress ? 'button' : undefined}
        onClick={onPress}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={cn(
          'flex items-center gap-4 w-full bg-surface p-4 text-left transition-colors relative',
          onPress && 'cursor-pointer hover:bg-surface-light',
          className,
        )}
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping ? 'none' : 'transform 200ms ease',
        }}
      >
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] tracking-[-0.15px] font-normal text-text truncate">{title}</div>
          {subtitle && <div className="text-[13px] tracking-[-0.13px] text-text-dim mt-1 truncate">{subtitle}</div>}
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </Comp>
    </div>
  );
}

export { ListItem };
export type { ListItemProps };
