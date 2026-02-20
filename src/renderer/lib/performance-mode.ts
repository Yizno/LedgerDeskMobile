import type { PerformanceMode } from '@shared';

export const performanceModeOrder: PerformanceMode[] = ['off', 'lite', 'aggressive', 'extreme'];

export const performanceModeLabels: Record<PerformanceMode, string> = {
  off: 'Off',
  lite: 'Lite',
  aggressive: 'Aggressive',
  extreme: 'Extreme',
};

export const performanceModeDescriptions: Record<PerformanceMode, string> = {
  off: 'Full visuals and animations.',
  lite: 'Disable transitions and decorative animations.',
  aggressive: 'Lite plus flatter visuals and static charts.',
  extreme: 'Aggressive plus lightweight dashboard and reduced analytics payloads.',
};

export const performanceModeRootClasses = ['perf-mode-lite', 'perf-mode-aggressive', 'perf-mode-extreme'] as const;

export function rootClassForPerformanceMode(mode: PerformanceMode): (typeof performanceModeRootClasses)[number] | null {
  switch (mode) {
    case 'lite':
      return 'perf-mode-lite';
    case 'aggressive':
      return 'perf-mode-aggressive';
    case 'extreme':
      return 'perf-mode-extreme';
    default:
      return null;
  }
}

export function disableUiAnimations(mode: PerformanceMode) {
  return mode !== 'off';
}

export function flattenVisualEffects(mode: PerformanceMode) {
  return mode === 'aggressive' || mode === 'extreme';
}

export function useStaticCharts(mode: PerformanceMode) {
  return mode === 'aggressive' || mode === 'extreme';
}

export function useLightweightDashboard(mode: PerformanceMode) {
  return mode === 'extreme';
}

export function analyticsProfile(mode: PerformanceMode): {
  trendBucket: 'daily' | 'weekly';
  timelineLimit: number;
} {
  if (mode === 'extreme') {
    return {
      trendBucket: 'weekly',
      timelineLimit: 300,
    };
  }

  return {
    trendBucket: 'daily',
    timelineLimit: 1000,
  };
}
