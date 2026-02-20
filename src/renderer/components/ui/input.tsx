import * as React from 'react';
import { cn } from '../../lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none ring-offset-neutral-950 placeholder:text-neutral-500 focus:ring-2 focus:ring-neutral-500/80',
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';
