import { useEffect } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

export function Modal({ open, title, onClose, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="perf-surface-modal fixed inset-0 z-50 flex items-end justify-center bg-neutral-950/85 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      data-no-pull-refresh="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={cn(
          'perf-surface-card flex max-h-[calc(100dvh-0.5rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-neutral-700 bg-neutral-900 sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-2xl',
          className,
        )}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
          <h2 className="pr-2 text-base font-semibold text-neutral-100 sm:text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 py-3 sm:p-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
