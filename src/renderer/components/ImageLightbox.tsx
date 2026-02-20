import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PurchaseImageRecord } from '@shared';
import { Modal } from './ui/modal';
import { Button } from './ui/button';

type Props = {
  open: boolean;
  images: PurchaseImageRecord[];
  startIndex: number;
  onClose: () => void;
};

export function ImageLightbox({ open, images, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setIndex(startIndex);
  }, [startIndex]);

  useEffect(() => {
    const selected = images[index];
    if (!selected) {
      setUrl(null);
      return;
    }

    let active = true;
    void window.bookkeeping.media.readDataUrl({
      relativePath: selected.relativePath,
      mimeType: selected.mimeType,
    }).then((dataUrl) => {
      if (active) {
        setUrl(dataUrl);
      }
    }).catch(() => {
      if (active) {
        setUrl(null);
      }
    });

    return () => {
      active = false;
    };
  }, [images, index]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        setIndex((current) => (current + 1) % Math.max(images.length, 1));
      }
      if (event.key === 'ArrowLeft') {
        setIndex((current) => (current - 1 + Math.max(images.length, 1)) % Math.max(images.length, 1));
      }
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [images.length, onClose, open]);

  return (
    <Modal open={open} title="Receipt Viewer" onClose={onClose} className="max-w-5xl bg-neutral-950">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIndex((index - 1 + images.length) % images.length)}
            disabled={images.length === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center text-xs text-neutral-400">
            {images.length > 0 ? `${index + 1} / ${images.length} - ${images[index]?.originalName ?? ''}` : '0 / 0'}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIndex((index + 1) % images.length)}
            disabled={images.length === 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black/60 p-2">
          {url ? (
            <img src={url} alt="Receipt" className="max-h-[66vh] w-full object-contain" />
          ) : (
            <div className="grid h-[40vh] place-items-center text-neutral-500">No image selected</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
