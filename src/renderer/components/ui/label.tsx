import type React from 'react';
import { cn } from '../../lib/cn';

type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return <label className={cn('mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400', className)} {...props} />;
}
