import type { BookkeepingPreloadApi } from '@shared';

declare global {
  interface Window {
    bookkeeping: BookkeepingPreloadApi;
  }
}

export {};
