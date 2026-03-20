import * as React from 'react';
import { cn } from '../utils/cn';
import type { ReactNode } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

function BottomSheet({ open, onClose, children, className }: BottomSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        className={cn(
          'relative z-10 w-full max-w-[393px] bg-bg rounded-t-[6px] shadow-[0px_-4px_12px_0px_rgba(0,0,0,0.12)] pt-3',
          className,
        )}
      >
        {children}
        {/* Home indicator */}
        <div className="flex items-center justify-center h-[42px]">
          <div className="w-[139px] h-[5px] rounded-full bg-text" />
        </div>
      </div>
    </div>
  );
}

export { BottomSheet };
export type { BottomSheetProps };
