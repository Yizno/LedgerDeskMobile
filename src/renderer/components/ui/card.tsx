import type React from 'react';
import { cn } from '../../lib/cn';

type CardProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'perf-surface-card rounded-2xl border border-neutral-800 bg-neutral-900/80 shadow-[0_12px_30px_rgba(0,0,0,0.38)] backdrop-blur-sm',
        className,
      )}
      {...props}
    />
  );
}
