import { appSettingsSchema, type AppSettings } from '@shared';

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify(appSettingsSchema.parse(settings));
}

export function deserializeSettings(raw: string): AppSettings {
  return appSettingsSchema.parse(JSON.parse(raw));
}

export function calculateBudgetVariance(budgetCents: number, actualCents: number) {
  return {
    varianceCents: budgetCents - actualCents,
    utilizationPercent: budgetCents === 0 ? 0 : Number(((actualCents / budgetCents) * 100).toFixed(2)),
  };
}

export function defaultSettings(): AppSettings {
  return {
    theme: 'dark',
    baseCurrency: 'USD',
    overallMonthlyBudgetCents: 0,
    performanceMode: 'off',
    previewImages: true,
    lastFilters: {
      limit: 100,
      offset: 0,
    },
  };
}
