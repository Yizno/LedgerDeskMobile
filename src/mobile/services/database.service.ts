import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import {
  appSettingsSchema,
  budgetInputSchema,
  categoryInputSchema,
  dashboardSummarySchema,
  purchaseCreateInputSchema,
  purchaseFilterInputSchema,
  purchaseTimelineQuerySchema,
  purchaseUpdateInputSchema,
  tagInputSchema,
  type AppSettings,
  type BudgetInput,
  type CategoryBreakdownPoint,
  type DashboardSummary,
  type PurchaseCreateInput,
  type PurchaseFilterInput,
  type PurchaseRecord,
  type PurchaseTimelineQuery,
  type PurchaseUpdateInput,
  type SnapshotRecord,
  type SpendingTrendPoint,
  type TagInput,
  type CategoryInput,
  type MonthlyBudgetRecord,
  type CategoryRecord,
  type TagRecord,
  type BudgetVsActualRecord,
  type PurchaseImageRecord,
} from '@shared';
import { buildPurchaseFilterSql } from '../lib/filter-query';
import { calculateBudgetVariance, defaultSettings, deserializeSettings, serializeSettings } from '../lib/settings';
import { PathsService } from './paths.service';
import { SqliteWasmService } from './sqlite-wasm.service';

const migrationSql = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  purchase_date TEXT NOT NULL,
  vendor TEXT,
  notes TEXT,
  category_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON purchases(vendor);
CREATE INDEX IF NOT EXISTS idx_purchases_amount ON purchases(amount_cents);
CREATE INDEX IF NOT EXISTS idx_purchases_category ON purchases(category_id);
CREATE TABLE IF NOT EXISTS purchase_images (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_purchase_images_purchase ON purchase_images(purchase_id);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  color_hex TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name, parent_id),
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  color_hex TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE TABLE IF NOT EXISTS purchase_tags (
  purchase_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  UNIQUE (purchase_id, tag_id),
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_purchase_tags_purchase ON purchase_tags(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_tags_tag ON purchase_tags(tag_id);
CREATE TABLE IF NOT EXISTS monthly_budgets (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  budget_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (category_id, year, month),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ocr_extractions (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_image_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  amount_candidate_cents INTEGER,
  vendor_candidate TEXT,
  date_candidate TEXT,
  confidence_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_image_id) REFERENCES purchase_images(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ocr_extractions_image ON ocr_extractions(purchase_image_id);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source_zip TEXT,
  is_active INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dataset_snapshots_active ON dataset_snapshots(is_active);
`;

const ftsMigrationSql = `
CREATE VIRTUAL TABLE IF NOT EXISTS purchases_fts USING fts5(
  purchase_id UNINDEXED,
  name,
  vendor,
  notes,
  tokenize = 'porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS purchases_ai AFTER INSERT ON purchases BEGIN
  INSERT INTO purchases_fts (purchase_id, name, vendor, notes)
  VALUES (new.id, new.name, coalesce(new.vendor, ''), coalesce(new.notes, ''));
END;
CREATE TRIGGER IF NOT EXISTS purchases_ad AFTER DELETE ON purchases BEGIN
  DELETE FROM purchases_fts WHERE purchase_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS purchases_au AFTER UPDATE ON purchases BEGIN
  UPDATE purchases_fts
  SET name = new.name, vendor = coalesce(new.vendor, ''), notes = coalesce(new.notes, '')
  WHERE purchase_id = new.id;
END;
`;

function normalizeDate(date: string): string {
  return dayjs(date).isValid() ? dayjs(date).format('YYYY-MM-DD') : date;
}

type PurchaseCoreRow = {
  id: string;
  name: string;
  amount_cents: number;
  currency: string;
  purchase_date: string;
  vendor: string | null;
  notes: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
};

export class DatabaseService {
  private readonly paths: PathsService;
  private store: SqliteWasmService | null = null;
  private activeDatasetId = '';

  private constructor(paths: PathsService) {
    this.paths = paths;
  }

  static async create(paths: PathsService) {
    const service = new DatabaseService(paths);
    await service.init();
    return service;
  }

  private ensureStore() {
    if (!this.store) {
      throw new Error('Database store is not initialized.');
    }
    return this.store;
  }

  private async init() {
    const active = await this.paths.ensureActiveSnapshot();
    this.activeDatasetId = active.id;
    this.store = new SqliteWasmService(this.paths.getDatabasePath(active.id));
    await this.store.open();
    this.runMigrations();
    await this.ensureDefaultSettings();
    await this.store.persist();
  }

  getActiveDatasetId() {
    return this.activeDatasetId;
  }

  getActiveDatabasePath() {
    return this.paths.getDatabasePath(this.activeDatasetId);
  }

  getActiveMediaRoot() {
    return this.paths.getMediaDir(this.activeDatasetId);
  }

  async switchSnapshot(snapshotId: string) {
    await this.paths.activateSnapshot(snapshotId);
    this.store?.close();
    this.activeDatasetId = snapshotId;
    this.store = new SqliteWasmService(this.paths.getDatabasePath(snapshotId));
    await this.store.open();
    this.runMigrations();
    await this.ensureDefaultSettings();
    await this.store.persist();
  }

  close() {
    this.store?.close();
    this.store = null;
  }

  private runMigrations() {
    this.ensureStore().exec(migrationSql);
    try {
      this.ensureStore().exec(ftsMigrationSql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (/no such module:\s*fts5/i.test(message)) {
        console.warn('FTS5 is unavailable in this SQLite runtime. Continuing without full-text indexes.');
        return;
      }
      throw error;
    }
  }

  async ensureDefaultSettings() {
    const existing = this.ensureStore().get<{ key: string; value_json: string }>(
      'SELECT key, value_json FROM app_settings WHERE key = ? LIMIT 1',
      ['app'],
    );

    if (!existing) {
      const defaults = defaultSettings();
      this.ensureStore().run('INSERT INTO app_settings (key, value_json) VALUES (?, ?)', [
        'app',
        serializeSettings(defaults),
      ]);
      await this.ensureStore().persist();
    }
  }

  getSettings(): AppSettings {
    const found = this.ensureStore().get<{ key: string; value_json: string }>(
      'SELECT key, value_json FROM app_settings WHERE key = ? LIMIT 1',
      ['app'],
    );

    if (!found) {
      return defaultSettings();
    }

    try {
      const parsed = deserializeSettings(found.value_json);
      return {
        ...parsed,
        theme: 'dark',
      };
    } catch {
      return defaultSettings();
    }
  }

  async updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
    const current = this.getSettings();
    const next = appSettingsSchema.parse({
      ...current,
      ...input,
      theme: 'dark',
      lastFilters: {
        ...current.lastFilters,
        ...input.lastFilters,
      },
    });

    this.ensureStore().run(
      `
      INSERT INTO app_settings (key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
      `,
      ['app', serializeSettings(next)],
    );
    await this.ensureStore().persist();
    return next;
  }

  async listSnapshots(): Promise<SnapshotRecord[]> {
    return this.paths.getSnapshotList();
  }

  async addSnapshot(label: string, sourceZip: string | null, setActive = false): Promise<SnapshotRecord> {
    return this.paths.addSnapshot(
      {
        id: nanoid(12),
        label,
        createdAt: new Date().toISOString(),
        sourceZip,
      },
      setActive,
    );
  }

  async createPurchase(input: PurchaseCreateInput): Promise<PurchaseRecord> {
    const parsed = purchaseCreateInputSchema.parse(input);
    const id = nanoid(12);
    const now = new Date().toISOString();

    this.ensureStore().run(
      `
      INSERT INTO purchases (
        id, name, amount_cents, currency, purchase_date, vendor, notes, category_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        parsed.name,
        parsed.amountCents,
        parsed.currency ?? this.getSettings().baseCurrency,
        normalizeDate(parsed.purchaseDate),
        parsed.vendor ?? null,
        parsed.notes ?? null,
        parsed.categoryId ?? null,
        now,
        now,
      ],
    );

    for (const tagId of parsed.tagIds) {
      this.ensureStore().run(
        `
        INSERT OR IGNORE INTO purchase_tags (purchase_id, tag_id) VALUES (?, ?)
        `,
        [id, tagId],
      );
    }

    await this.ensureStore().persist();
    return this.getPurchaseOrThrow(id);
  }

  async updatePurchase(input: PurchaseUpdateInput): Promise<PurchaseRecord> {
    const parsed = purchaseUpdateInputSchema.parse(input);
    const existing = this.getPurchase(parsed.id);
    if (!existing) {
      throw new Error('Purchase not found');
    }

    this.ensureStore().run(
      `
      UPDATE purchases SET
        name = ?,
        amount_cents = ?,
        currency = ?,
        purchase_date = ?,
        vendor = ?,
        notes = ?,
        category_id = ?,
        updated_at = ?
      WHERE id = ?
      `,
      [
        parsed.name ?? existing.name,
        parsed.amountCents ?? existing.amountCents,
        parsed.currency ?? existing.currency,
        parsed.purchaseDate ? normalizeDate(parsed.purchaseDate) : existing.purchaseDate,
        parsed.vendor === undefined ? existing.vendor : parsed.vendor,
        parsed.notes === undefined ? existing.notes : parsed.notes,
        parsed.categoryId === undefined ? existing.categoryId : parsed.categoryId,
        new Date().toISOString(),
        parsed.id,
      ],
    );

    if (parsed.tagIds) {
      this.ensureStore().run('DELETE FROM purchase_tags WHERE purchase_id = ?', [parsed.id]);
      for (const tagId of parsed.tagIds) {
        this.ensureStore().run('INSERT OR IGNORE INTO purchase_tags (purchase_id, tag_id) VALUES (?, ?)', [
          parsed.id,
          tagId,
        ]);
      }
    }

    await this.ensureStore().persist();
    return this.getPurchaseOrThrow(parsed.id);
  }

  async deletePurchase(id: string) {
    this.ensureStore().run('DELETE FROM purchases WHERE id = ?', [id]);
    await this.ensureStore().persist();
  }

  getPurchase(id: string): PurchaseRecord | null {
    const row = this.ensureStore().get<PurchaseCoreRow>('SELECT * FROM purchases WHERE id = ? LIMIT 1', [id]);
    if (!row) {
      return null;
    }
    return this.mapPurchase(row);
  }

  getPurchaseOrThrow(id: string): PurchaseRecord {
    const found = this.getPurchase(id);
    if (!found) {
      throw new Error(`Purchase ${id} not found`);
    }
    return found;
  }

  listPurchases(input: PurchaseFilterInput): { items: PurchaseRecord[]; total: number } {
    const filters = purchaseFilterInputSchema.parse(input);
    const built = buildPurchaseFilterSql(filters);
    const whereSql = built.whereSql;
    const values = built.values;

    const totalRow = this.ensureStore().get<{ count: number }>(`SELECT count(*) AS count FROM purchases p ${whereSql}`, [
      ...values,
    ]);

    const rows = this.ensureStore().all<PurchaseCoreRow>(
      `SELECT p.* FROM purchases p ${whereSql} ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT ? OFFSET ?`,
      [...values, filters.limit, filters.offset],
    );

    return {
      items: rows.map((row) => this.mapPurchase(row)),
      total: Number(totalRow?.count ?? 0),
    };
  }

  listTimeline(query: PurchaseTimelineQuery): PurchaseRecord[] {
    const parsed = purchaseTimelineQuerySchema.parse(query);
    const where: string[] = [];
    const values: unknown[] = [];

    if (parsed.fromDate) {
      where.push('purchase_date >= ?');
      values.push(parsed.fromDate);
    }

    if (parsed.toDate) {
      where.push('purchase_date <= ?');
      values.push(parsed.toDate);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.ensureStore().all<PurchaseCoreRow>(
      `SELECT * FROM purchases ${whereSql} ORDER BY purchase_date DESC, created_at DESC LIMIT ?`,
      [...values, parsed.limit],
    );

    return rows.map((row) => this.mapPurchase(row));
  }

  listImagesByPurchase(purchaseId: string): PurchaseImageRecord[] {
    const rows = this.ensureStore().all<any>(
      'SELECT * FROM purchase_images WHERE purchase_id = ? ORDER BY created_at ASC',
      [purchaseId],
    );
    return rows.map((row) => this.mapImage(row));
  }

  async addImageRecord(record: Omit<PurchaseImageRecord, 'createdAt'>) {
    this.ensureStore().run(
      `
      INSERT INTO purchase_images (
        id, purchase_id, relative_path, original_name, mime_type, size_bytes, width, height, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.id,
        record.purchaseId,
        record.relativePath,
        record.originalName,
        record.mimeType,
        record.sizeBytes,
        record.width,
        record.height,
        new Date().toISOString(),
      ],
    );
    await this.ensureStore().persist();
  }

  async removeImageRecord(imageId: string): Promise<PurchaseImageRecord | null> {
    const row = this.ensureStore().get<any>('SELECT * FROM purchase_images WHERE id = ? LIMIT 1', [imageId]);
    if (!row) {
      return null;
    }
    this.ensureStore().run('DELETE FROM purchase_images WHERE id = ?', [imageId]);
    await this.ensureStore().persist();
    return this.mapImage(row);
  }

  async createCategory(input: CategoryInput): Promise<CategoryRecord> {
    const parsed = categoryInputSchema.parse(input);
    const id = parsed.id ?? nanoid(12);
    const now = new Date().toISOString();

    this.ensureStore().run(
      `
      INSERT INTO categories (id, name, parent_id, color_hex, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        parent_id = excluded.parent_id,
        color_hex = excluded.color_hex,
        is_archived = excluded.is_archived,
        updated_at = excluded.updated_at
      `,
      [id, parsed.name, parsed.parentId ?? null, parsed.colorHex, parsed.isArchived ? 1 : 0, now, now],
    );
    await this.ensureStore().persist();

    const row = this.ensureStore().get<any>('SELECT * FROM categories WHERE id = ?', [id]);
    return this.mapCategory(row);
  }

  async deleteCategory(id: string) {
    this.ensureStore().run('UPDATE purchases SET category_id = NULL WHERE category_id = ?', [id]);
    this.ensureStore().run('DELETE FROM categories WHERE id = ?', [id]);
    await this.ensureStore().persist();
  }

  listCategories(): CategoryRecord[] {
    const rows = this.ensureStore().all<any>(
      'SELECT * FROM categories ORDER BY is_archived ASC, name ASC',
    );
    return rows.map((row) => this.mapCategory(row));
  }

  async createTag(input: TagInput): Promise<TagRecord> {
    const parsed = tagInputSchema.parse(input);
    const id = parsed.id ?? nanoid(12);
    const now = new Date().toISOString();

    this.ensureStore().run(
      `
      INSERT INTO tags (id, name, color_hex, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        color_hex = excluded.color_hex
      `,
      [id, parsed.name, parsed.colorHex, now],
    );
    await this.ensureStore().persist();
    const row = this.ensureStore().get<any>('SELECT * FROM tags WHERE id = ?', [id]);
    return this.mapTag(row);
  }

  async deleteTag(id: string) {
    this.ensureStore().run('DELETE FROM purchase_tags WHERE tag_id = ?', [id]);
    this.ensureStore().run('DELETE FROM tags WHERE id = ?', [id]);
    await this.ensureStore().persist();
  }

  listTags(): TagRecord[] {
    const rows = this.ensureStore().all<any>('SELECT * FROM tags ORDER BY name ASC');
    return rows.map((row) => this.mapTag(row));
  }

  async upsertBudget(input: BudgetInput): Promise<MonthlyBudgetRecord> {
    const parsed = budgetInputSchema.parse(input);
    const now = new Date().toISOString();

    const existing = this.ensureStore().get<{ id: string }>(
      'SELECT id FROM monthly_budgets WHERE category_id = ? AND year = ? AND month = ?',
      [parsed.categoryId, parsed.year, parsed.month],
    );

    const id = existing?.id ?? nanoid(12);

    this.ensureStore().run(
      `
      INSERT INTO monthly_budgets (id, category_id, year, month, budget_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(category_id, year, month) DO UPDATE SET
        budget_cents = excluded.budget_cents,
        updated_at = excluded.updated_at
      `,
      [id, parsed.categoryId, parsed.year, parsed.month, parsed.budgetCents, now, now],
    );

    await this.ensureStore().persist();

    const row = this.ensureStore().get<any>('SELECT * FROM monthly_budgets WHERE id = ?', [id]);
    return this.mapBudget(row);
  }

  listBudgets(year?: number, month?: number): MonthlyBudgetRecord[] {
    const where: string[] = [];
    const values: unknown[] = [];
    if (typeof year === 'number') {
      where.push('year = ?');
      values.push(year);
    }
    if (typeof month === 'number') {
      where.push('month = ?');
      values.push(month);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.ensureStore().all<any>(
      `SELECT * FROM monthly_budgets ${whereSql} ORDER BY year DESC, month DESC`,
      values,
    );
    return rows.map((row) => this.mapBudget(row));
  }

  getBudgetVsActual(year: number, month: number): BudgetVsActualRecord[] {
    const rows = this.ensureStore().all<any>(
      `
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.color_hex AS color_hex,
        coalesce(b.budget_cents, 0) AS budget_cents,
        coalesce(sum(p.amount_cents), 0) AS actual_cents
      FROM categories c
      LEFT JOIN monthly_budgets b
        ON b.category_id = c.id AND b.year = ? AND b.month = ?
      LEFT JOIN purchases p
        ON p.category_id = c.id
        AND strftime('%Y', p.purchase_date) = ?
        AND strftime('%m', p.purchase_date) = ?
      WHERE c.is_archived = 0
      GROUP BY c.id, c.name, c.color_hex, b.budget_cents
      HAVING coalesce(b.budget_cents, 0) > 0 OR coalesce(sum(p.amount_cents), 0) > 0
      ORDER BY actual_cents DESC
      `,
      [year, month, String(year), String(month).padStart(2, '0')],
    );

    return rows.map((row) => ({
      categoryId: String(row.category_id),
      categoryName: String(row.category_name),
      colorHex: String(row.color_hex),
      budgetCents: Number(row.budget_cents),
      actualCents: Number(row.actual_cents),
      varianceCents: calculateBudgetVariance(Number(row.budget_cents), Number(row.actual_cents)).varianceCents,
    }));
  }

  getDashboardSummary(anchorDate?: string): DashboardSummary {
    const now = anchorDate ? dayjs(anchorDate) : dayjs();
    const currentMonthStart = now.startOf('month').format('YYYY-MM-DD');
    const currentMonthEnd = now.endOf('month').format('YYYY-MM-DD');
    const prevMonthStart = now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
    const prevMonthEnd = now.subtract(1, 'month').endOf('month').format('YYYY-MM-DD');

    const current = this.sumAmountBetween(currentMonthStart, currentMonthEnd);
    const previous = this.sumAmountBetween(prevMonthStart, prevMonthEnd);
    const deltaPercent = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;

    const categoryBudgetTotal = this.ensureStore().get<{ total: number }>(
      'SELECT coalesce(sum(budget_cents), 0) AS total FROM monthly_budgets WHERE year = ? AND month = ?',
      [now.year(), now.month() + 1],
    );

    const settings = this.getSettings();
    const effectiveBudgetCents =
      settings.overallMonthlyBudgetCents > 0
        ? settings.overallMonthlyBudgetCents
        : Number(categoryBudgetTotal?.total ?? 0);

    const budgetUsedPercent =
      effectiveBudgetCents === 0 ? 0 : Math.min(999, Number(((current / effectiveBudgetCents) * 100).toFixed(2)));

    const recentCount = this.ensureStore().get<{ count: number }>(
      'SELECT count(*) AS count FROM purchases WHERE purchase_date >= ?',
      [currentMonthStart],
    );

    return dashboardSummarySchema.parse({
      currentMonthSpendCents: current,
      previousMonthSpendCents: previous,
      monthOverMonthDeltaPercent: Number(deltaPercent.toFixed(2)),
      budgetUsedPercent,
      recentPurchasesCount: Number(recentCount?.count ?? 0),
    });
  }

  getCategoryBreakdown(fromDate: string, toDate: string): CategoryBreakdownPoint[] {
    const rows = this.ensureStore().all<any>(
      `
      SELECT
        c.id AS category_id,
        coalesce(c.name, 'Uncategorized') AS category_name,
        coalesce(c.color_hex, '#737373') AS color_hex,
        sum(p.amount_cents) AS amount_cents
      FROM purchases p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.purchase_date >= ? AND p.purchase_date <= ?
      GROUP BY c.id, c.name, c.color_hex
      ORDER BY amount_cents DESC
      `,
      [fromDate, toDate],
    );

    const total = rows.reduce((sum, row) => sum + Number(row.amount_cents), 0);
    return rows.map((row) => ({
      categoryId: row.category_id ? String(row.category_id) : null,
      categoryName: String(row.category_name),
      colorHex: String(row.color_hex),
      amountCents: Number(row.amount_cents),
      percentage: total > 0 ? Number(((Number(row.amount_cents) / total) * 100).toFixed(2)) : 0,
    }));
  }

  getSpendingTrends(fromDate: string, toDate: string, bucket: 'daily' | 'weekly' = 'daily'): SpendingTrendPoint[] {
    if (bucket === 'weekly') {
      const rows = this.ensureStore().all<any>(
        `
        SELECT
          strftime('%Y-%W', purchase_date) AS date,
          sum(amount_cents) AS amount_cents
        FROM purchases
        WHERE purchase_date >= ? AND purchase_date <= ?
        GROUP BY strftime('%Y-%W', purchase_date)
        ORDER BY date ASC
        `,
        [fromDate, toDate],
      );
      return rows.map((row) => ({ date: String(row.date), amountCents: Number(row.amount_cents) }));
    }

    const rows = this.ensureStore().all<any>(
      `
      SELECT
        purchase_date AS date,
        sum(amount_cents) AS amount_cents
      FROM purchases
      WHERE purchase_date >= ? AND purchase_date <= ?
      GROUP BY purchase_date
      ORDER BY purchase_date ASC
      `,
      [fromDate, toDate],
    );

    return rows.map((row) => ({
      date: String(row.date),
      amountCents: Number(row.amount_cents),
    }));
  }

  rawAll<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.ensureStore().all<T>(sql, params);
  }

  rawGet<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): T | undefined {
    return this.ensureStore().get<T>(sql, params);
  }

  rawRun(sql: string, params: unknown[] = []) {
    this.ensureStore().run(sql, params);
  }

  async persistRaw() {
    await this.ensureStore().persist();
  }

  private sumAmountBetween(fromDate: string, toDate: string): number {
    const row = this.ensureStore().get<{ amount: number }>(
      'SELECT coalesce(sum(amount_cents), 0) AS amount FROM purchases WHERE purchase_date >= ? AND purchase_date <= ?',
      [fromDate, toDate],
    );
    return Number(row?.amount ?? 0);
  }

  private mapPurchase(row: PurchaseCoreRow): PurchaseRecord {
    const tagsRows = this.ensureStore().all<any>(
      `
      SELECT t.*
      FROM tags t
      INNER JOIN purchase_tags pt ON pt.tag_id = t.id
      WHERE pt.purchase_id = ?
      ORDER BY t.name ASC
      `,
      [row.id],
    );

    const imageRows = this.ensureStore().all<any>(
      'SELECT * FROM purchase_images WHERE purchase_id = ? ORDER BY created_at ASC',
      [row.id],
    );

    return {
      id: row.id,
      name: row.name,
      amountCents: Number(row.amount_cents),
      currency: row.currency,
      purchaseDate: row.purchase_date,
      vendor: row.vendor,
      notes: row.notes,
      categoryId: row.category_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tags: tagsRows.map((tag) => this.mapTag(tag)),
      images: imageRows.map((image) => this.mapImage(image)),
    };
  }

  private mapImage(row: any): PurchaseImageRecord {
    return {
      id: String(row.id),
      purchaseId: String(row.purchase_id),
      relativePath: String(row.relative_path),
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      width: row.width === null || row.width === undefined ? null : Number(row.width),
      height: row.height === null || row.height === undefined ? null : Number(row.height),
      createdAt: String(row.created_at),
    };
  }

  private mapCategory(row: any): CategoryRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      parentId: row.parent_id ? String(row.parent_id) : null,
      colorHex: String(row.color_hex),
      isArchived: Boolean(Number(row.is_archived)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTag(row: any): TagRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      colorHex: String(row.color_hex),
      createdAt: String(row.created_at),
    };
  }

  private mapBudget(row: any): MonthlyBudgetRecord {
    return {
      id: String(row.id),
      categoryId: String(row.category_id),
      year: Number(row.year),
      month: Number(row.month),
      budgetCents: Number(row.budget_cents),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
