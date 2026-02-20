import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { CategoryRecord, PurchaseFilterInput, PurchaseRecord, TagRecord } from '@shared';
import { formatCurrency, formatDate } from '../lib/format';
import { clampReceiptIndex, cycleReceiptIndex } from '../lib/receipt-carousel';
import { ConfirmDialog } from './ConfirmDialog';
import { ImageLightbox } from './ImageLightbox';
import { PurchaseEditModal } from './PurchaseEditModal';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Props = {
  purchases: PurchaseRecord[];
  total: number;
  categories: CategoryRecord[];
  tags: TagRecord[];
  filters: PurchaseFilterInput;
  onChangeFilters: (filters: PurchaseFilterInput) => void;
  onOpenQuickAdd: () => void;
  previewImages: boolean;
  onRefresh: () => Promise<void>;
};

export function PurchasesPanel({
  purchases,
  total,
  categories,
  tags,
  filters,
  onChangeFilters,
  onOpenQuickAdd,
  previewImages,
  onRefresh,
}: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<string[]>([]);
  const [lightboxPurchase, setLightboxPurchase] = useState<PurchaseRecord | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRecord | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<{
    ids: string[];
    description: string;
  } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [receiptIndexByPurchaseId, setReceiptIndexByPurchaseId] = useState<Record<string, number>>({});
  const [thumbnailUrlByImageId, setThumbnailUrlByImageId] = useState<Record<string, string>>({});
  const [thumbnailErrorByImageId, setThumbnailErrorByImageId] = useState<Record<string, boolean>>({});

  const categoriesById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category])),
    [categories],
  );

  useEffect(() => {
    const visibleIds = new Set(purchases.map((purchase) => purchase.id));
    setSelectedPurchaseIds((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [purchases]);

  useEffect(() => {
    setReceiptIndexByPurchaseId((prev) => {
      const next: Record<string, number> = {};
      for (const purchase of purchases) {
        if (purchase.images.length === 0) {
          continue;
        }
        next[purchase.id] = clampReceiptIndex(prev[purchase.id] ?? 0, purchase.images.length);
      }
      return next;
    });
  }, [purchases]);

  const activeReceiptImages = useMemo(
    () =>
      !previewImages
        ? []
        :
      purchases.flatMap((purchase) => {
        if (purchase.images.length === 0) {
          return [];
        }

        const index = clampReceiptIndex(receiptIndexByPurchaseId[purchase.id] ?? 0, purchase.images.length);
        const image = purchase.images[index];
        return image ? [image] : [];
      }),
    [previewImages, purchases, receiptIndexByPurchaseId],
  );

  useEffect(() => {
    if (!previewImages) {
      return;
    }

    const unresolved = activeReceiptImages.filter(
      (image) => !thumbnailUrlByImageId[image.id] && !thumbnailErrorByImageId[image.id],
    );
    if (unresolved.length === 0) {
      return;
    }

    let active = true;
    void Promise.all(
      unresolved.map(async (image) => {
        try {
          const dataUrl = await window.bookkeeping.media.readDataUrl({
            relativePath: image.relativePath,
            mimeType: image.mimeType,
          });
          return {
            id: image.id,
            url: dataUrl,
            failed: false,
          } as const;
        } catch {
          return { id: image.id, url: '', failed: true } as const;
        }
      }),
    ).then((results) => {
      if (!active) {
        return;
      }

      const nextUrls: Record<string, string> = {};
      const nextErrors: Record<string, boolean> = {};
      for (const result of results) {
        if (result.failed) {
          nextErrors[result.id] = true;
        } else {
          nextUrls[result.id] = result.url;
        }
      }

      if (Object.keys(nextUrls).length > 0) {
        setThumbnailUrlByImageId((prev) => ({ ...prev, ...nextUrls }));
      }
      if (Object.keys(nextErrors).length > 0) {
        setThumbnailErrorByImageId((prev) => ({ ...prev, ...nextErrors }));
      }
    });

    return () => {
      active = false;
    };
  }, [previewImages, activeReceiptImages, thumbnailErrorByImageId, thumbnailUrlByImageId]);

  const removePurchase = async () => {
    if (!deleteIntent) {
      return;
    }
    setDeletePending(true);
    try {
      for (const id of deleteIntent.ids) {
        await window.bookkeeping.purchase.delete(id);
      }
      setSelectedPurchaseIds((prev) => prev.filter((id) => !deleteIntent.ids.includes(id)));
      setDeleteIntent(null);
      onChangeFilters({ ...filters });
      void onRefresh();
    } finally {
      setDeletePending(false);
    }
  };

  const togglePurchaseSelection = (purchaseId: string) => {
    setSelectedPurchaseIds((prev) =>
      prev.includes(purchaseId) ? prev.filter((id) => id !== purchaseId) : [...prev, purchaseId],
    );
  };

  const clearSelection = () => {
    setSelectedPurchaseIds([]);
  };

  const cycleReceipt = (purchase: PurchaseRecord, direction: -1 | 1) => {
    if (purchase.images.length <= 1) {
      return;
    }

    setReceiptIndexByPurchaseId((prev) => {
      const current = clampReceiptIndex(prev[purchase.id] ?? 0, purchase.images.length);
      return {
        ...prev,
        [purchase.id]: cycleReceiptIndex(current, purchase.images.length, direction),
      };
    });
  };

  const visiblePurchaseIds = purchases.map((purchase) => purchase.id);
  const allVisibleSelected =
    visiblePurchaseIds.length > 0 && visiblePurchaseIds.every((purchaseId) => selectedPurchaseIds.includes(purchaseId));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedPurchaseIds((prev) => prev.filter((id) => !visiblePurchaseIds.includes(id)));
      return;
    }

    setSelectedPurchaseIds((prev) => [...new Set([...prev, ...visiblePurchaseIds])]);
  };

  const clearFilters = () => {
    onChangeFilters({
      limit: filters.limit ?? 120,
      offset: 0,
      query: undefined,
      fromDate: undefined,
      toDate: undefined,
      categoryIds: undefined,
      tagIds: undefined,
      vendor: undefined,
      minAmountCents: undefined,
      maxAmountCents: undefined,
    });
  };

  const hasActiveFilters =
    Boolean(filters.query) ||
    Boolean(filters.fromDate) ||
    Boolean(filters.toDate) ||
    Boolean(filters.vendor) ||
    typeof filters.minAmountCents === 'number' ||
    typeof filters.maxAmountCents === 'number' ||
    (filters.categoryIds?.length ?? 0) > 0 ||
    (filters.tagIds?.length ?? 0) > 0;

  return (
    <Card className="p-4">
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative min-w-0 sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-500" />
          <Input
            className="pl-9"
            placeholder="Search name, vendor, notes"
            value={filters.query ?? ''}
            onChange={(event) => onChangeFilters({ ...filters, query: event.target.value || undefined })}
          />
        </div>
        <Button variant="secondary" onClick={() => setShowFilters((prev) => !prev)} className="w-full">
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
        </Button>
        <Button variant="ghost" onClick={() => void onRefresh()} className="w-full">
          Refresh
        </Button>
        <Button variant="ghost" onClick={clearFilters} disabled={!hasActiveFilters} className="w-full">
          Clear Filters
        </Button>
        <Button
          variant="destructive"
          onClick={() =>
            setDeleteIntent({
              ids: [...selectedPurchaseIds],
              description: `Delete ${selectedPurchaseIds.length} selected purchase${selectedPurchaseIds.length === 1 ? '' : 's'} permanently? This cannot be undone.`,
            })
          }
          disabled={selectedPurchaseIds.length === 0}
          className="w-full"
        >
          Delete Selected ({selectedPurchaseIds.length})
        </Button>
        <Button variant="ghost" onClick={clearSelection} disabled={selectedPurchaseIds.length === 0} className="w-full">
          Clear Selection
        </Button>
        <Button onClick={onOpenQuickAdd} className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          Add Purchase
        </Button>
      </div>

      {showFilters ? (
        <div className="mb-4 grid gap-3 rounded-xl border border-neutral-800 bg-neutral-950/80 p-3 md:grid-cols-4">
          <div>
            <Label>From Date</Label>
            <Input
              type="date"
              value={filters.fromDate ?? ''}
              onChange={(event) => onChangeFilters({ ...filters, fromDate: event.target.value || undefined })}
            />
          </div>
          <div>
            <Label>To Date</Label>
            <Input
              type="date"
              value={filters.toDate ?? ''}
              onChange={(event) => onChangeFilters({ ...filters, toDate: event.target.value || undefined })}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Categories (multi-select)</Label>
            <div className="max-h-32 overflow-auto rounded-lg border border-neutral-700 bg-neutral-900/60 p-2">
              <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => {
                const selected = filters.categoryIds?.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={`rounded-full border px-2 py-0.5 text-xs transition ${
                      selected
                        ? 'border-neutral-200 bg-neutral-200 text-neutral-900'
                        : 'border-neutral-600 bg-neutral-900 text-neutral-300'
                    }`}
                    onClick={() => {
                      const next = selected
                        ? (filters.categoryIds ?? []).filter((id) => id !== category.id)
                        : [...(filters.categoryIds ?? []), category.id];
                      onChangeFilters({
                        ...filters,
                        categoryIds: next.length > 0 ? next : undefined,
                      });
                    }}
                  >
                    {category.name}
                  </button>
                );
              })}
              {categories.length === 0 ? <span className="text-xs text-neutral-500">No categories</span> : null}
              </div>
            </div>
          </div>
          <div>
            <Label>Vendor</Label>
            <Input
              value={filters.vendor ?? ''}
              onChange={(event) => onChangeFilters({ ...filters, vendor: event.target.value || undefined })}
            />
          </div>

          <div>
            <Label>Min Amount (USD)</Label>
            <Input
              type="number"
              step="0.01"
              value={filters.minAmountCents ? (filters.minAmountCents / 100).toString() : ''}
              onChange={(event) =>
                onChangeFilters({
                  ...filters,
                  minAmountCents: event.target.value ? Math.round(Number(event.target.value) * 100) : undefined,
                })
              }
            />
          </div>
          <div>
            <Label>Max Amount (USD)</Label>
            <Input
              type="number"
              step="0.01"
              value={filters.maxAmountCents ? (filters.maxAmountCents / 100).toString() : ''}
              onChange={(event) =>
                onChangeFilters({
                  ...filters,
                  maxAmountCents: event.target.value ? Math.round(Number(event.target.value) * 100) : undefined,
                })
              }
            />
          </div>
          <div className="md:col-span-2">
            <Label>Tags</Label>
            <div className="max-h-32 overflow-auto rounded-lg border border-neutral-700 bg-neutral-900/60 p-2">
              <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const selected = filters.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`rounded-full border px-2 py-0.5 text-xs transition ${
                      selected
                        ? 'border-neutral-200 bg-neutral-200 text-neutral-900'
                        : 'border-neutral-600 bg-neutral-900 text-neutral-300'
                    }`}
                    onClick={() => {
                      const next = selected
                        ? (filters.tagIds ?? []).filter((id) => id !== tag.id)
                        : [...(filters.tagIds ?? []), tag.id];
                      onChangeFilters({ ...filters, tagIds: next.length > 0 ? next : undefined });
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
              {tags.length === 0 ? <span className="text-xs text-neutral-500">No tags</span> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs text-neutral-400 md:hidden">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAllVisible}
            className="h-4 w-4 accent-neutral-400"
            title="Select all visible purchases"
          />
          Select all visible
        </label>
        <span>{selectedPurchaseIds.length} selected</span>
      </div>

      <div className="mb-3 text-xs uppercase tracking-wide text-neutral-500">{total} purchases found</div>

      <div className="space-y-3 md:hidden">
        {purchases.map((purchase) => {
          const category = purchase.categoryId ? categoriesById[purchase.categoryId] : null;
          const selected = selectedPurchaseIds.includes(purchase.id);
          const receiptIndex = clampReceiptIndex(receiptIndexByPurchaseId[purchase.id] ?? 0, purchase.images.length);
          const activeReceiptImage = purchase.images[receiptIndex] ?? null;
          const activeReceiptUrl = activeReceiptImage ? thumbnailUrlByImageId[activeReceiptImage.id] : '';
          const activeReceiptLoadFailed = activeReceiptImage ? Boolean(thumbnailErrorByImageId[activeReceiptImage.id]) : false;

          return (
            <article
              key={purchase.id}
              className={`rounded-xl border p-3 ${
                selected ? 'border-neutral-500 bg-neutral-800/40' : 'border-neutral-800 bg-neutral-900/70'
              }`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <label className="flex min-w-0 cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => togglePurchaseSelection(purchase.id)}
                    className="mt-0.5 h-4 w-4 accent-neutral-400"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-100">{purchase.name}</span>
                    <span className="block text-xs text-neutral-500">
                      {formatDate(purchase.purchaseDate)} | {purchase.vendor ?? 'No vendor'}
                    </span>
                  </span>
                </label>
                <div className="text-right">
                  <div className="text-sm font-semibold text-neutral-100">
                    {formatCurrency(purchase.amountCents, purchase.currency)}
                  </div>
                  <div className="mt-1">
                    {category ? <Badge color={category.colorHex}>{category.name}</Badge> : <Badge>Uncategorized</Badge>}
                  </div>
                </div>
              </div>

              <div className="mb-2 flex flex-wrap gap-1">
                {purchase.tags.map((tag) => (
                  <Badge key={tag.id} color={tag.colorHex}>
                    {tag.name}
                  </Badge>
                ))}
                {purchase.tags.length === 0 ? <span className="text-xs text-neutral-500">No tags</span> : null}
              </div>

              {purchase.images.length > 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
                  <div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
                    <span>
                      Receipt {receiptIndex + 1}/{purchase.images.length}
                    </span>
                    {purchase.images.length > 1 ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => cycleReceipt(purchase, -1)}>
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => cycleReceipt(purchase, 1)}>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="w-full overflow-hidden rounded-md border border-neutral-700 text-left"
                    onClick={() => {
                      setLightboxPurchase(purchase);
                      setLightboxIndex(receiptIndex);
                    }}
                    aria-label={`Open receipt image ${receiptIndex + 1} of ${purchase.images.length}`}
                  >
                    {previewImages ? (
                      activeReceiptUrl ? (
                        <img
                          src={activeReceiptUrl}
                          alt={activeReceiptImage?.originalName ?? 'Receipt image'}
                          className="h-32 w-full object-cover"
                        />
                      ) : activeReceiptLoadFailed ? (
                        <div className="grid h-24 place-items-center bg-neutral-900 text-xs text-neutral-500">Unavailable</div>
                      ) : (
                        <div className="grid h-24 place-items-center bg-neutral-900 text-xs text-neutral-500">Loading...</div>
                      )
                    ) : (
                      <div className="grid h-16 place-items-center bg-neutral-900 text-sm text-neutral-300">Open Receipt</div>
                    )}
                  </button>
                </div>
              ) : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="ghost" onClick={() => setEditingPurchase(purchase)} className="w-full">
                  <Pencil className="mr-1 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    setDeleteIntent({
                      ids: [purchase.id],
                      description: `Delete "${purchase.name}" permanently? This cannot be undone.`,
                    })
                  }
                  className="w-full"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </article>
          );
        })}
        {purchases.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 px-4 py-10 text-center text-neutral-500">
            No purchases match your filters.
          </div>
        ) : null}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-neutral-800 md:block">
        <div className="max-h-[58vh] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-neutral-900">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="h-4 w-4 accent-neutral-400"
                    title="Select all visible purchases"
                  />
                </th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Receipts</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => {
                const category = purchase.categoryId ? categoriesById[purchase.categoryId] : null;
                const selected = selectedPurchaseIds.includes(purchase.id);
                const receiptIndex = clampReceiptIndex(
                  receiptIndexByPurchaseId[purchase.id] ?? 0,
                  purchase.images.length,
                );
                const activeReceiptImage = purchase.images[receiptIndex] ?? null;
                const activeReceiptUrl = activeReceiptImage ? thumbnailUrlByImageId[activeReceiptImage.id] : '';
                const activeReceiptLoadFailed = activeReceiptImage
                  ? Boolean(thumbnailErrorByImageId[activeReceiptImage.id])
                  : false;
                return (
                  <tr
                    key={purchase.id}
                    className={`border-t border-neutral-800/80 text-neutral-200 hover:bg-neutral-800/40 ${
                      selected ? 'bg-neutral-800/35' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => togglePurchaseSelection(purchase.id)}
                        className="h-4 w-4 accent-neutral-400"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-400">{formatDate(purchase.purchaseDate)}</td>
                    <td className="px-3 py-2 font-medium">{purchase.name}</td>
                    <td className="px-3 py-2 text-neutral-300">{purchase.vendor ?? 'N/A'}</td>
                    <td className="px-3 py-2">
                      {category ? <Badge color={category.colorHex}>{category.name}</Badge> : <span className="text-neutral-500">None</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-h-16 overflow-auto pr-1">
                        <div className="flex flex-wrap gap-1">
                        {purchase.tags.map((tag) => (
                          <Badge key={tag.id} color={tag.colorHex}>
                            {tag.name}
                          </Badge>
                        ))}
                        {purchase.tags.length === 0 ? <span className="text-neutral-500">-</span> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatCurrency(purchase.amountCents, purchase.currency)}</td>
                    <td className="px-3 py-2">
                      {purchase.images.length > 0 ? (
                        <div className="flex min-w-0 flex-col gap-1">
                          {previewImages ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded-md border border-neutral-700 p-1 text-neutral-300 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => cycleReceipt(purchase, -1)}
                                disabled={purchase.images.length <= 1}
                                aria-label="Previous receipt image"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="overflow-hidden rounded-md border border-neutral-700 hover:border-neutral-500"
                                onClick={() => {
                                  setLightboxPurchase(purchase);
                                  setLightboxIndex(receiptIndex);
                                }}
                                aria-label={`Open receipt image ${receiptIndex + 1} of ${purchase.images.length}`}
                              >
                                {activeReceiptUrl ? (
                                  <img
                                    src={activeReceiptUrl}
                                    alt={activeReceiptImage?.originalName ?? 'Receipt image'}
                                    className="h-14 w-24 object-cover"
                                  />
                                ) : activeReceiptLoadFailed ? (
                                  <div className="grid h-14 w-24 place-items-center bg-neutral-900 text-[10px] text-neutral-500">
                                    Unavailable
                                  </div>
                                ) : (
                                  <div className="grid h-14 w-24 place-items-center bg-neutral-900 text-[10px] text-neutral-500">
                                    Loading...
                                  </div>
                                )}
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-neutral-700 p-1 text-neutral-300 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => cycleReceipt(purchase, 1)}
                                disabled={purchase.images.length <= 1}
                                aria-label="Next receipt image"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded-md border border-neutral-700 p-1 text-neutral-300 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => cycleReceipt(purchase, -1)}
                                disabled={purchase.images.length <= 1}
                                aria-label="Previous receipt image"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 transition hover:border-neutral-500"
                                onClick={() => {
                                  setLightboxPurchase(purchase);
                                  setLightboxIndex(receiptIndex);
                                }}
                                aria-label={`Open receipt image ${receiptIndex + 1} of ${purchase.images.length}`}
                              >
                                Open
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-neutral-700 p-1 text-neutral-300 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => cycleReceipt(purchase, 1)}
                                disabled={purchase.images.length <= 1}
                                aria-label="Next receipt image"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          <div className="text-center text-[10px] text-neutral-500">
                            {receiptIndex + 1}/{purchase.images.length}
                          </div>
                        </div>
                      ) : (
                        <span className="text-neutral-500">None</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingPurchase(purchase)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDeleteIntent({
                              ids: [purchase.id],
                              description: `Delete "${purchase.name}" permanently? This cannot be undone.`,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-neutral-500">
                    No purchases match your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ImageLightbox
        open={Boolean(lightboxPurchase)}
        images={lightboxPurchase?.images ?? []}
        startIndex={lightboxIndex}
        onClose={() => setLightboxPurchase(null)}
      />
      <PurchaseEditModal
        open={Boolean(editingPurchase)}
        purchase={editingPurchase}
        categories={categories}
        tags={tags}
        onClose={() => setEditingPurchase(null)}
        onSaved={onRefresh}
      />
      <ConfirmDialog
        open={Boolean(deleteIntent)}
        title={deleteIntent && deleteIntent.ids.length > 1 ? 'Delete Purchases' : 'Delete Purchase'}
        description={deleteIntent?.description ?? 'Delete this purchase permanently?'}
        confirmLabel="Delete"
        loading={deletePending}
        onCancel={() => setDeleteIntent(null)}
        onConfirm={() => void removePurchase()}
      />
    </Card>
  );
}
