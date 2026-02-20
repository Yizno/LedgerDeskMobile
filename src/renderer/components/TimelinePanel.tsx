import { useMemo } from 'react';
import dayjs from 'dayjs';
import type { CategoryRecord, PurchaseRecord } from '@shared';
import { formatCurrency } from '../lib/format';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

type Props = {
  purchases: PurchaseRecord[];
  categories: CategoryRecord[];
};

export function TimelinePanel({ purchases, categories }: Props) {
  const categoriesById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category])),
    [categories],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, PurchaseRecord[]>();
    for (const purchase of purchases) {
      const key = dayjs(purchase.purchaseDate).format('YYYY MMMM');
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(purchase);
    }
    return Array.from(map.entries());
  }, [purchases]);

  return (
    <Card className="p-4">
      <h3 className="mb-4 text-lg font-semibold text-neutral-100">Purchase Timeline</h3>
      <div className="max-h-[64vh] overflow-auto rounded-xl border border-neutral-800">
        <div className="space-y-6 p-4">
          {grouped.map(([monthLabel, monthPurchases]) => (
            <section key={monthLabel}>
              <div className="sticky top-0 z-10 mb-2 rounded-md bg-neutral-950/90 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {monthLabel}
              </div>
              <div className="space-y-3 border-l border-neutral-700 pl-4">
                {monthPurchases.map((purchase) => {
                  const category = purchase.categoryId ? categoriesById[purchase.categoryId] : null;
                  return (
                    <article key={purchase.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-neutral-100">{purchase.name}</div>
                          <div className="text-xs text-neutral-500">
                            {dayjs(purchase.purchaseDate).format('MMM D, YYYY')} • {purchase.vendor ?? 'No vendor'}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-neutral-100">{formatCurrency(purchase.amountCents)}</div>
                      </div>
                      <div className="max-h-16 overflow-auto pr-1">
                        <div className="flex flex-wrap gap-2">
                          {category ? <Badge color={category.colorHex}>{category.name}</Badge> : <Badge>Uncategorized</Badge>}
                          {purchase.tags.map((tag) => (
                            <Badge key={tag.id} color={tag.colorHex}>
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {grouped.length === 0 ? <p className="text-sm text-neutral-500">No timeline data available yet.</p> : null}
        </div>
      </div>
    </Card>
  );
}

