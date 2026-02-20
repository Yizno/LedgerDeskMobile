import type { PurchaseFilterInput } from '@shared';

export type BuiltFilterQuery = {
  whereSql: string;
  values: unknown[];
};

export function buildPurchaseFilterSql(filters: PurchaseFilterInput): BuiltFilterQuery {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.fromDate) {
    conditions.push('p.purchase_date >= ?');
    values.push(filters.fromDate);
  }

  if (filters.toDate) {
    conditions.push('p.purchase_date <= ?');
    values.push(filters.toDate);
  }

  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const placeholders = filters.categoryIds.map(() => '?').join(',');
    conditions.push(`p.category_id IN (${placeholders})`);
    values.push(...filters.categoryIds);
  }

  if (filters.vendor) {
    conditions.push("lower(coalesce(p.vendor, '')) LIKE lower(?)");
    values.push(`%${filters.vendor}%`);
  }

  if (typeof filters.minAmountCents === 'number') {
    conditions.push('p.amount_cents >= ?');
    values.push(filters.minAmountCents);
  }

  if (typeof filters.maxAmountCents === 'number') {
    conditions.push('p.amount_cents <= ?');
    values.push(filters.maxAmountCents);
  }

  if (filters.tagIds && filters.tagIds.length > 0) {
    const placeholders = filters.tagIds.map(() => '?').join(',');
    conditions.push(
      `p.id IN (SELECT purchase_id FROM purchase_tags WHERE tag_id IN (${placeholders}) GROUP BY purchase_id HAVING count(DISTINCT tag_id) = ${filters.tagIds.length})`,
    );
    values.push(...filters.tagIds);
  }

  if (filters.query) {
    conditions.push(
      "(lower(p.name) LIKE lower(?) OR lower(coalesce(p.vendor, '')) LIKE lower(?) OR lower(coalesce(p.notes, '')) LIKE lower(?))",
    );
    const queryLike = `%${filters.query.trim()}%`;
    values.push(queryLike, queryLike, queryLike);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereSql, values };
}
