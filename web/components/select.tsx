import * as React from 'react';
import { cn } from '../utils/cn';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  onValueChange?: (value: string) => void;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, onValueChange, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full bg-input-bg text-text rounded-[6px] pl-4 pr-8 text-[17px] tracking-[-0.17px] outline-none transition-colors cursor-pointer',
        className,
      )}
      onChange={(e) => onValueChange?.(e.target.value)}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
);

Select.displayName = 'Select';

export { Select };
export type { SelectProps, SelectOption };
