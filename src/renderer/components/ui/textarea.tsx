import * as React from 'react';
import { cn } from '../../lib/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'min-h-20 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none ring-offset-neutral-950 placeholder:text-neutral-500 focus:ring-2 focus:ring-neutral-500/80',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
