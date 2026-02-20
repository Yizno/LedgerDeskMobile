import ReactECharts from 'echarts-for-react';
import type {
  BudgetVsActualRecord,
  CategoryBreakdownPoint,
  DashboardSummary,
  PerformanceMode,
  PurchaseRecord,
  SpendingTrendPoint,
} from '@shared';
import { formatCurrency, formatDate } from '../lib/format';
import { useLightweightDashboard, useStaticCharts } from '../lib/performance-mode';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

type Props = {
  summary: DashboardSummary | null;
  categoryBreakdown: CategoryBreakdownPoint[];
  trends: SpendingTrendPoint[];
  budgetVsActual: BudgetVsActualRecord[];
  recentPurchases: PurchaseRecord[];
  performanceMode: PerformanceMode;
};

export function DashboardPanel({
  summary,
  categoryBreakdown,
  trends,
  budgetVsActual,
  recentPurchases,
  performanceMode,
}: Props) {
  const staticCharts = useStaticCharts(performanceMode);
  const lightweightDashboard = useLightweightDashboard(performanceMode);

  const pieOption = {
    animation: !staticCharts,
    tooltip: { trigger: 'item' },
    backgroundColor: 'transparent',
    series: [
      {
        type: 'pie',
        radius: ['45%', '76%'],
        itemStyle: { borderRadius: 10, borderColor: '#1f1f1f', borderWidth: 2 },
        label: staticCharts ? { show: false } : { color: '#d4d4d4' },
        avoidLabelOverlap: !staticCharts,
        animation: !staticCharts,
        data: categoryBreakdown.map((item) => ({
          value: item.amountCents / 100,
          name: item.categoryName,
          itemStyle: { color: item.colorHex },
        })),
      },
    ],
  };

  const trendValues = trends.map((item) => item.amountCents / 100);
  const hasSinglePoint = trendValues.length === 1;
  const singlePointValue = trendValues[0] ?? 0;
  const singlePointPadding = Math.max(1, singlePointValue * 0.25);
  const maxTrendAmountCents = Math.max(1, ...trends.map((point) => point.amountCents));

  const trendOption = {
    animation: !staticCharts,
    grid: { left: 40, right: 20, top: 24, bottom: 28 },
    xAxis: {
      type: 'category',
      boundaryGap: hasSinglePoint,
      axisLine: { lineStyle: { color: '#525252' } },
      axisLabel: { color: '#a3a3a3' },
      data: trends.map((item) => item.date),
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#525252' } },
      splitLine: { lineStyle: { color: '#404040' } },
      axisLabel: { color: '#a3a3a3' },
      min: hasSinglePoint ? Math.max(0, Number((singlePointValue - singlePointPadding).toFixed(2))) : undefined,
      max: hasSinglePoint ? Number((singlePointValue + singlePointPadding).toFixed(2)) : undefined,
    },
    series: [
      {
        type: 'line',
        smooth: !hasSinglePoint && !staticCharts,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: hasSinglePoint ? 12 : staticCharts ? 5 : 7,
        itemStyle: { color: '#a3a3a3' },
        lineStyle: { color: '#a3a3a3', width: 2.4 },
        areaStyle: hasSinglePoint || staticCharts
          ? undefined
          : {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(163,163,163,0.32)' },
                  { offset: 1, color: 'rgba(163,163,163,0.01)' },
                ],
              },
            },
        data: trendValues,
      },
    ],
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) => formatCurrency(Math.round(value * 100)),
    },
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <KpiCard label="Current Month" value={summary ? formatCurrency(summary.currentMonthSpendCents) : '-'} />
        <KpiCard label="Previous Month" value={summary ? formatCurrency(summary.previousMonthSpendCents) : '-'} />
        <KpiCard
          label="Month-over-Month Change"
          value={summary ? `${summary.monthOverMonthDeltaPercent.toFixed(2)}%` : '-'}
          tone={summary && summary.monthOverMonthDeltaPercent > 0 ? 'warn' : 'good'}
        />
        <KpiCard
          label="Budget Used"
          value={summary ? `${summary.budgetUsedPercent.toFixed(1)}%` : '-'}
          tone={summary && summary.budgetUsedPercent > 100 ? 'warn' : 'good'}
        />
      </div>

      {lightweightDashboard ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="p-4 xl:col-span-1">
            <h3 className="mb-2 text-sm font-semibold text-neutral-200">Category Breakdown</h3>
            <div className="space-y-2">
              {categoryBreakdown.slice(0, 10).map((item) => (
                <div key={`${item.categoryId ?? 'uncategorized'}-${item.categoryName}`}>
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-300">
                    <Badge color={item.colorHex}>{item.categoryName}</Badge>
                    <span>{formatCurrency(item.amountCents)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-neutral-800">
                    <div
                      className="h-full"
                      style={{
                        backgroundColor: item.colorHex,
                        width: `${Math.max(2, Math.min(100, item.percentage))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              {categoryBreakdown.length === 0 ? <p className="text-sm text-neutral-500">No category data available.</p> : null}
            </div>
          </Card>

          <Card className="p-4 xl:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-neutral-200">Spending Trend</h3>
            <div className="space-y-2">
              {trends.slice(-20).map((item) => (
                <div key={item.date}>
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-300">
                    <span>{item.date}</span>
                    <span>{formatCurrency(item.amountCents)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-neutral-800">
                    <div
                      className="h-full bg-neutral-400"
                      style={{
                        width: `${Math.max(
                          2,
                          Math.min(100, (item.amountCents / maxTrendAmountCents) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              {trends.length === 0 ? <p className="text-sm text-neutral-500">No trend data available.</p> : null}
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="p-4 xl:col-span-1">
            <h3 className="mb-2 text-sm font-semibold text-neutral-200">Category Breakdown</h3>
            <ReactECharts option={pieOption} style={{ height: 300 }} opts={{ renderer: 'canvas' }} />
          </Card>

          <Card className="p-4 xl:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-neutral-200">Spending Trend</h3>
            <ReactECharts option={trendOption} style={{ height: 300 }} opts={{ renderer: 'canvas' }} />
          </Card>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-200">Budget vs Actual</h3>
          <div className="max-h-[46vh] space-y-2 overflow-auto pr-1">
            {budgetVsActual.map((item) => (
              <div key={item.categoryId} className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
                <div className="mb-1 flex items-center justify-between text-xs text-neutral-300">
                  <Badge color={item.colorHex}>{item.categoryName}</Badge>
                  <span>
                    {formatCurrency(item.actualCents)} / {formatCurrency(item.budgetCents)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-neutral-800">
                  <div
                    className={`h-full ${item.actualCents > item.budgetCents ? 'bg-neutral-500' : 'bg-neutral-400'}`}
                    style={{
                      width: `${Math.min(100, item.budgetCents === 0 ? 0 : (item.actualCents / item.budgetCents) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {budgetVsActual.length === 0 ? <p className="text-sm text-neutral-500">No budget data configured.</p> : null}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-200">Recent Purchases</h3>
          <div className="max-h-[46vh] space-y-2 overflow-auto pr-1">
            {recentPurchases.slice(0, 8).map((purchase) => (
              <div key={purchase.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2 text-sm">
                <div className="flex items-center justify-between text-neutral-200">
                  <span>{purchase.name}</span>
                  <span>{formatCurrency(purchase.amountCents)}</span>
                </div>
                <div className="text-xs text-neutral-500">{formatDate(purchase.purchaseDate)}</div>
              </div>
            ))}
            {recentPurchases.length === 0 ? <p className="text-sm text-neutral-500">No recent purchases yet.</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone === 'warn' ? 'text-neutral-300' : 'text-neutral-100'}`}>{value}</div>
    </Card>
  );
}
