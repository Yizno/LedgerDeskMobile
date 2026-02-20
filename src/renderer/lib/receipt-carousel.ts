export function clampReceiptIndex(index: number, imageCount: number) {
  if (imageCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), imageCount - 1);
}

export function cycleReceiptIndex(index: number, imageCount: number, direction: -1 | 1) {
  if (imageCount <= 0) {
    return 0;
  }

  return (index + direction + imageCount) % imageCount;
}
