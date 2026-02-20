import type React from 'react';
import { cn } from '../../lib/cn';

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  color?: string;
};

export function Badge({ className, color, style, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-neutral-700/80 px-2.5 py-0.5 text-xs font-medium text-neutral-200',
        className,
      )}
      style={{
        backgroundColor: color ? `${color}22` : undefined,
        borderColor: color ? `${color}55` : undefined,
        ...style,
      }}
      {...props}
    />
  );
}
