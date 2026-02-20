import { type TouchEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronDown, Copy, FileText, History, Minus, Plus, RefreshCw, Settings2, Square, X, Zap } from 'lucide-react';
import type {
  AppSettings,
  BudgetVsActualRecord,
  CategoryBreakdownPoint,
  CategoryRecord,
  DashboardSummary,
  MonthlyBudgetRecord,
  PerformanceMode,
  PurchaseFilterInput,
  PurchaseRecord,
  SnapshotRecord,
  SpendingTrendPoint,
  TagRecord,
} from '@shared';
import { DashboardPanel } from './components/DashboardPanel';
import { ManagementPanel } from './components/ManagementPanel';
import { PurchasesPanel } from './components/PurchasesPanel';
import { QuickAddModal } from './components/QuickAddModal';
import { TimelinePanel } from './components/TimelinePanel';
import { monthBounds, yearBounds } from './lib/format';
import {
  analyticsProfile,
  performanceModeDescriptions,
  performanceModeLabels,
  performanceModeOrder,
  performanceModeRootClasses,
  rootClassForPerformanceMode,
} from './lib/performance-mode';

type ViewKey = 'dashboard' | 'purchases' | 'timeline' | 'management';

const defaultFilters: PurchaseFilterInput = {
  limit: 120,
  offset: 0,
};

export function App() {
  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [view, setView] = useState<ViewKey>('dashboard');
  const [loading, setLoading] = useState(true);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const [filters, setFilters] = useState<PurchaseFilterInput>(defaultFilters);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [purchaseTotal, setPurchaseTotal] = useState(0);

  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [budgets, setBudgets] = useState<MonthlyBudgetRecord[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>('off');
  const [previewImages, setPreviewImages] = useState(true);
  const [performanceMenuOpen, setPerformanceMenuOpen] = useState(false);
  const [savingPerformanceMode, setSavingPerformanceMode] = useState(false);
  const [savingPreviewImages, setSavingPreviewImages] = useState(false);

  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownPoint[]>([]);
  const [trendPoints, setTrendPoints] = useState<SpendingTrendPoint[]>([]);
  const [budgetVsActual, setBudgetVsActual] = useState<BudgetVsActualRecord[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<PurchaseRecord[]>([]);
  const [timelinePurchases, setTimelinePurchases] = useState<PurchaseRecord[]>([]);
  const filtersInitializedRef = useRef(false);
  const filtersRef = useRef<PurchaseFilterInput>(defaultFilters);
  const firstLoadDoneRef = useRef(false);
  const purchasesRequestSeqRef = useRef(0);
  const performanceMenuRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullActiveRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const loadPurchases = useCallback(async (nextFilters: PurchaseFilterInput) => {
    const requestSeq = ++purchasesRequestSeqRef.current;
    const result = await window.bookkeeping.purchase.list(nextFilters);
    if (requestSeq !== purchasesRequestSeqRef.current) {
      return;
    }
    setPurchases(result.items);
    setPurchaseTotal(result.total);
  }, []);
  const handleFiltersChange = useCallback(
    (nextFilters: PurchaseFilterInput) => {
      setFilters(nextFilters);
      void loadPurchases(nextFilters);
    },
    [loadPurchases],
  );

  const loadMasterData = useCallback(async () => {
    const [categoryList, tagList, currentSettings, budgetList, snapshotList] = await Promise.all([
      window.bookkeeping.category.list(),
      window.bookkeeping.tag.list(),
      window.bookkeeping.settings.get(),
      window.bookkeeping.budget.list(),
      window.bookkeeping.backup.listSnapshots(),
    ]);

    setCategories(categoryList);
    setTags(tagList);
    setSettings(currentSettings);
    setBudgets(budgetList);
    setSnapshots(snapshotList);

    return currentSettings as AppSettings;
  }, []);

  const loadAnalytics = useCallback(async () => {
    const month = monthBounds();
    const year = yearBounds();
    const profile = analyticsProfile(performanceMode);

    const [summary, breakdown, trends, budgetCompare, recent, timeline] = await Promise.all([
      window.bookkeeping.analytics.dashboard(),
      window.bookkeeping.analytics.monthly(month),
      window.bookkeeping.analytics.trends({ ...year, bucket: profile.trendBucket }),
      window.bookkeeping.budget.vsActual({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 }),
      window.bookkeeping.purchase.list({ limit: 8, offset: 0 }),
      window.bookkeeping.purchase.timeline({ limit: profile.timelineLimit }),
    ]);

    setDashboardSummary(summary);
    setCategoryBreakdown(breakdown);
    setTrendPoints(trends);
    setBudgetVsActual(budgetCompare);
    setRecentPurchases(recent.items);
    setTimelinePurchases(timeline);
  }, [performanceMode]);

  const refreshAll = useCallback(async () => {
    const showLoadingState = !firstLoadDoneRef.current;
    if (showLoadingState) {
      setLoading(true);
    }
    try {
      const currentSettings = await loadMasterData();
      const nextFilters = !filtersInitializedRef.current
        ? { ...defaultFilters, ...(currentSettings.lastFilters ?? {}) }
        : filtersRef.current;
      if (!filtersInitializedRef.current) {
        filtersInitializedRef.current = true;
        setFilters(nextFilters);
      }
      await Promise.all([loadPurchases(nextFilters), loadAnalytics()]);
    } finally {
      if (showLoadingState) {
        firstLoadDoneRef.current = true;
        setLoading(false);
      }
    }
  }, [loadAnalytics, loadMasterData, loadPurchases]);

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (isWindows || quickAddOpen || loading || pullRefreshing) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('[data-no-pull-refresh="true"]')) {
        return;
      }
      if (window.scrollY <= 0) {
        pullStartYRef.current = event.touches[0]?.clientY ?? null;
        pullActiveRef.current = true;
      }
    },
    [isWindows, loading, pullRefreshing, quickAddOpen],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (!pullActiveRef.current || pullStartYRef.current === null || pullRefreshing) {
        return;
      }
      if (window.scrollY > 0) {
        return;
      }
      const currentY = event.touches[0]?.clientY ?? pullStartYRef.current;
      const delta = currentY - pullStartYRef.current;
      if (delta <= 0) {
        setPullDistance(0);
        return;
      }

      const nextDistance = Math.min(100, delta * 0.45);
      setPullDistance(nextDistance);
      if (delta > 8) {
        event.preventDefault();
      }
    },
    [pullRefreshing],
  );

  const handleTouchEnd = useCallback(() => {
    if (!pullActiveRef.current) {
      return;
    }
    const shouldRefresh = pullDistance >= 72 && !pullRefreshing;
    pullActiveRef.current = false;
    pullStartYRef.current = null;
    setPullDistance(0);
    if (shouldRefresh) {
      setPullRefreshing(true);
      void refreshAll().finally(() => setPullRefreshing(false));
    }
  }, [pullDistance, pullRefreshing, refreshAll]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    const unsubscribe = window.bookkeeping.quickAdd.onOpen(() => setQuickAddOpen(true));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (quickAddOpen) {
      pullActiveRef.current = false;
      pullStartYRef.current = null;
      setPullDistance(0);
    }
  }, [quickAddOpen]);

  useEffect(() => {
    if (isWindows) {
      return;
    }

    let rafId = 0;
    const normalizeViewport = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        const viewport = document.querySelector('meta[name="viewport"]');
        viewport?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
      });
    };

    normalizeViewport();
    window.addEventListener('orientationchange', normalizeViewport);
    window.addEventListener('resize', normalizeViewport);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('orientationchange', normalizeViewport);
      window.removeEventListener('resize', normalizeViewport);
    };
  }, [isWindows]);

  useEffect(() => {
    if (isWindows) {
      return;
    }

    const blurEditableOnOutsidePress = (event: PointerEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) {
        return;
      }

      const isEditable =
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable;

      if (!isEditable) {
        return;
      }

      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (active.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      active.blur();
    };

    document.addEventListener('pointerdown', blurEditableOnOutsidePress, true);
    return () => document.removeEventListener('pointerdown', blurEditableOnOutsidePress, true);
  }, [isWindows]);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('dark');
    html.classList.remove(...performanceModeRootClasses);
    const rootClass = rootClassForPerformanceMode(performanceMode);
    if (rootClass) {
      html.classList.add(rootClass);
    }
  }, [performanceMode]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setPerformanceMode(settings.performanceMode);
    setPreviewImages(settings.previewImages);
  }, [settings?.performanceMode, settings?.previewImages, settings]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void window.bookkeeping.settings.set({ lastFilters: filters });
    }, 150);

    return () => window.clearTimeout(timeout);
  }, [filters, settings]);

  useEffect(() => {
    if (!performanceMenuOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!performanceMenuRef.current?.contains(event.target as Node)) {
        setPerformanceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPerformanceMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [performanceMenuOpen]);

  const refreshWindowState = useCallback(async () => {
    if (!isWindows) {
      return;
    }
    const state = await window.bookkeeping.windowControls.isMaximized();
    setIsWindowMaximized(state.maximized);
  }, [isWindows]);

  useEffect(() => {
    if (!isWindows) {
      return;
    }

    void refreshWindowState();
    const syncState = () => {
      void refreshWindowState();
    };
    window.addEventListener('resize', syncState);
    window.addEventListener('focus', syncState);
    return () => {
      window.removeEventListener('resize', syncState);
      window.removeEventListener('focus', syncState);
    };
  }, [isWindows, refreshWindowState]);

  const toggleWindowMaximize = useCallback(async () => {
    if (!isWindows) {
      return;
    }
    const state = await window.bookkeeping.windowControls.toggleMaximize();
    setIsWindowMaximized(state.maximized);
  }, [isWindows]);

  const setAndPersistPerformanceMode = useCallback(
    async (nextMode: PerformanceMode) => {
      if (nextMode === performanceMode || savingPerformanceMode) {
        setPerformanceMenuOpen(false);
        return;
      }

      const previousMode = performanceMode;
      setPerformanceMode(nextMode);
      setPerformanceMenuOpen(false);
      setSavingPerformanceMode(true);
      try {
        const updated = await window.bookkeeping.settings.set({ performanceMode: nextMode });
        setSettings(updated as AppSettings);
      } catch {
        setPerformanceMode(previousMode);
      } finally {
        setSavingPerformanceMode(false);
      }
    },
    [performanceMode, savingPerformanceMode],
  );

  const setAndPersistPreviewImages = useCallback(
    async (nextValue: boolean) => {
      if (nextValue === previewImages || savingPreviewImages) {
        setPerformanceMenuOpen(false);
        return;
      }

      const previousValue = previewImages;
      setPreviewImages(nextValue);
      setPerformanceMenuOpen(false);
      setSavingPreviewImages(true);
      try {
        const updated = await window.bookkeeping.settings.set({ previewImages: nextValue });
        setSettings(updated as AppSettings);
      } catch {
        setPreviewImages(previousValue);
      } finally {
        setSavingPreviewImages(false);
      }
    },
    [previewImages, savingPreviewImages],
  );

  const navigation = useMemo(
    () => [
      { key: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
      { key: 'purchases' as const, label: 'Purchases', icon: FileText },
      { key: 'timeline' as const, label: 'Timeline', icon: History },
      { key: 'management' as const, label: 'Management', icon: Settings2 },
    ],
    [],
  );

  return (
    <div
      className="min-h-screen bg-app-gradient text-neutral-100"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {!isWindows ? (
        <div
          className={`pointer-events-none fixed inset-x-0 top-2 z-40 flex justify-center transition-opacity ${
            pullDistance > 0 || pullRefreshing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div
            className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/95 px-3 py-1.5 text-xs text-neutral-300 shadow-lg"
            style={{ transform: `translateY(${Math.min(12, pullDistance / 4)}px)` }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pullRefreshing || pullDistance >= 72 ? 'animate-spin' : ''}`} />
            {pullRefreshing ? 'Refreshing...' : pullDistance >= 72 ? 'Release to refresh' : 'Pull to refresh'}
          </div>
        </div>
      ) : null}
      {isWindows ? (
        <div
          className="fixed inset-x-0 top-0 z-50 border-b border-neutral-800/80 bg-neutral-950/95"
          style={{ WebkitAppRegion: 'drag' } as any}
          onDoubleClick={() => void toggleWindowMaximize()}
        >
          <div className="flex h-10 w-full items-center justify-between pl-3 pr-0">
            <div className="text-xs font-semibold tracking-wide text-neutral-300">LedgerDesk</div>
            <div className="flex h-full items-stretch" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <button
                type="button"
                className="grid w-12 place-items-center text-neutral-300 transition hover:bg-neutral-800/85"
                onClick={() => void refreshAll()}
                title="Reload Data"
                aria-label="Reload data"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <div className="relative" ref={performanceMenuRef}>
                <button
                  type="button"
                  className="flex h-full w-[128px] items-center justify-center gap-1.5 text-neutral-300 transition hover:bg-neutral-800/85 disabled:opacity-70"
                  onClick={() => setPerformanceMenuOpen((prev) => !prev)}
                  title="Fast mode"
                  aria-label="Fast mode"
                  aria-haspopup="menu"
                  aria-expanded={performanceMenuOpen}
                  disabled={savingPerformanceMode || savingPreviewImages}
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold tracking-wide">FAST</span>
                  <span className="text-[11px] text-neutral-400">{performanceModeLabels[performanceMode]}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {performanceMenuOpen ? (
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-neutral-700 bg-neutral-900/95 p-1 shadow-xl">
                    {performanceModeOrder.map((mode) => {
                      const active = mode === performanceMode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          className={`w-full rounded-md px-3 py-2 text-left transition ${
                            active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-800/80'
                          }`}
                          onClick={() => void setAndPersistPerformanceMode(mode)}
                        >
                          <div className="text-sm font-semibold">{performanceModeLabels[mode]}</div>
                          <div className="text-xs text-neutral-400">{performanceModeDescriptions[mode]}</div>
                        </button>
                      );
                    })}
                    <div className="my-1 border-t border-neutral-700/70" />
                    <button
                      type="button"
                      className="w-full rounded-md px-3 py-2 text-left text-neutral-300 transition hover:bg-neutral-800/80"
                      onClick={() => void setAndPersistPreviewImages(!previewImages)}
                      disabled={savingPreviewImages}
                    >
                      <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                        <span>Preview Images</span>
                        <span className="text-neutral-100">{previewImages ? 'True' : 'False'}</span>
                      </div>
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="grid w-12 place-items-center text-neutral-300 transition hover:bg-neutral-800/85"
                onClick={() => void window.bookkeeping.windowControls.minimize()}
                title="Minimize"
                aria-label="Minimize"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="grid w-12 place-items-center text-neutral-300 transition hover:bg-neutral-800/85"
                onClick={() => void toggleWindowMaximize()}
                title={isWindowMaximized ? 'Restore' : 'Maximize'}
                aria-label={isWindowMaximized ? 'Restore' : 'Maximize'}
              >
                {isWindowMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                className="grid w-12 place-items-center text-neutral-300 transition hover:bg-rose-600/85 hover:text-white"
                onClick={() => void window.bookkeeping.windowControls.close()}
                title="Close"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className={`mx-auto max-w-[1600px] px-4 md:px-6 lg:px-8 ${isWindows ? 'pt-14 pb-4' : 'safe-mobile-bottom pt-4 pb-28'}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <nav className="flex flex-wrap gap-2">
            {navigation.map((item) => {
              const active = view === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                    active
                      ? 'border-neutral-500 bg-neutral-500/20 text-neutral-100'
                      : 'border-neutral-700 bg-neutral-900/70 text-neutral-300 hover:border-neutral-500'
                  }`}
                  onClick={() => setView(item.key)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <main className="animate-fade-in">
          {loading ? (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-10 text-center text-neutral-400">Loading data...</div>
          ) : null}

          {!loading && view === 'dashboard' ? (
            <DashboardPanel
              summary={dashboardSummary}
              categoryBreakdown={categoryBreakdown}
              trends={trendPoints}
              budgetVsActual={budgetVsActual}
              recentPurchases={recentPurchases}
              performanceMode={performanceMode}
            />
          ) : null}

          {!loading && view === 'purchases' ? (
            <PurchasesPanel
              purchases={purchases}
              total={purchaseTotal}
              categories={categories}
              tags={tags}
              filters={filters}
              onChangeFilters={handleFiltersChange}
              onOpenQuickAdd={() => setQuickAddOpen(true)}
              previewImages={previewImages}
              onRefresh={refreshAll}
            />
          ) : null}

          {!loading && view === 'timeline' ? <TimelinePanel purchases={timelinePurchases} categories={categories} /> : null}

          {!loading && view === 'management' ? (
            <ManagementPanel
              categories={categories}
              tags={tags}
              budgets={budgets}
              snapshots={snapshots}
              settings={settings}
              onRefresh={refreshAll}
            />
          ) : null}
        </main>

        <QuickAddModal
          open={quickAddOpen}
          categories={categories}
          tags={tags}
          onClose={() => setQuickAddOpen(false)}
          onCreated={refreshAll}
        />
      </div>
      {!isWindows && !quickAddOpen ? (
        <button
          type="button"
          className="safe-fab-offset fixed right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full border border-neutral-500 bg-neutral-500/20 text-neutral-100 shadow-lg backdrop-blur transition hover:border-neutral-300"
          onClick={() => setQuickAddOpen(true)}
          title="Quick Add"
          aria-label="Quick Add"
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
