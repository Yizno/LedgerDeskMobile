import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import type { AppSettings, CategoryRecord, MonthlyBudgetRecord, SnapshotRecord, TagRecord } from '@shared';
import { formatCurrency, fromCents, toCents } from '../lib/format';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ConfirmDialog } from './ConfirmDialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';

type Props = {
  categories: CategoryRecord[];
  tags: TagRecord[];
  budgets: MonthlyBudgetRecord[];
  snapshots: SnapshotRecord[];
  settings: AppSettings | null;
  onRefresh: () => Promise<void>;
};

const categoryPalette = ['#525252', '#6b7280', '#737373', '#a3a3a3', '#4b5563', '#404040', '#9ca3af'];
const customCsvColumnLabels = {
  includeDate: 'Date',
  includeVendor: 'Vendor',
  includeAmount: 'Amount',
  includeCategory: 'Category',
} as const;

export function ManagementPanel({ categories, tags, budgets, snapshots, settings, onRefresh }: Props) {
  const [newCategory, setNewCategory] = useState({ name: '', colorHex: categoryPalette[0], parentId: '' });
  const [newTag, setNewTag] = useState({ name: '', colorHex: '#737373' });
  const [editingCategory, setEditingCategory] = useState<{
    id: string;
    name: string;
    colorHex: string;
    parentId: string;
    isArchived: boolean;
  } | null>(null);
  const [editingTag, setEditingTag] = useState<{
    id: string;
    name: string;
    colorHex: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [overallBudgetAmount, setOverallBudgetAmount] = useState('');
  const [newBudget, setNewBudget] = useState({
    categoryId: '',
    year: dayjs().year(),
    month: dayjs().month() + 1,
    amount: '',
  });
  const [importPath, setImportPath] = useState('');
  const [customCsvColumns, setCustomCsvColumns] = useState({
    includeDate: true,
    includeVendor: true,
    includeAmount: true,
    includeCategory: true,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportingCustomCsv, setExportingCustomCsv] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState<{ kind: 'category' | 'tag'; ids: string[] } | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  useEffect(() => {
    const overallBudget = settings?.overallMonthlyBudgetCents ?? 0;
    setOverallBudgetAmount(overallBudget > 0 ? fromCents(overallBudget) : '');
  }, [settings?.overallMonthlyBudgetCents]);

  const budgetsByCategory = useMemo(() => {
    const map = new Map<string, MonthlyBudgetRecord[]>();
    for (const budget of budgets) {
      if (!map.has(budget.categoryId)) {
        map.set(budget.categoryId, []);
      }
      map.get(budget.categoryId)!.push(budget);
    }
    return map;
  }, [budgets]);

  const selectedCustomCsvColumnCount = useMemo(
    () => Object.values(customCsvColumns).filter(Boolean).length,
    [customCsvColumns],
  );

  const createCategory = async () => {
    if (!newCategory.name.trim()) {
      return;
    }

    await window.bookkeeping.category.create({
      name: newCategory.name,
      colorHex: newCategory.colorHex,
      parentId: newCategory.parentId || null,
      isArchived: false,
    });
    setNewCategory({ name: '', colorHex: categoryPalette[0], parentId: '' });
    await onRefresh();
  };

  const startEditCategory = (category: CategoryRecord) => {
    setEditingCategory({
      id: category.id,
      name: category.name,
      colorHex: category.colorHex,
      parentId: category.parentId ?? '',
      isArchived: category.isArchived,
    });
  };

  const saveEditedCategory = async () => {
    if (!editingCategory || !editingCategory.name.trim()) {
      return;
    }

    setEditSaving(true);
    try {
      await window.bookkeeping.category.update({
        id: editingCategory.id,
        name: editingCategory.name.trim(),
        parentId: editingCategory.parentId || null,
        colorHex: editingCategory.colorHex,
        isArchived: editingCategory.isArchived,
      });
      setEditingCategory(null);
      await onRefresh();
    } finally {
      setEditSaving(false);
    }
  };

  const toggleCategorySelection = (categoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId],
    );
  };

  const createTag = async () => {
    if (!newTag.name.trim()) {
      return;
    }
    await window.bookkeeping.tag.create(newTag);
    setNewTag({ name: '', colorHex: '#737373' });
    await onRefresh();
  };

  const startEditTag = (tag: TagRecord) => {
    setEditingTag({
      id: tag.id,
      name: tag.name,
      colorHex: tag.colorHex,
    });
  };

  const saveEditedTag = async () => {
    if (!editingTag || !editingTag.name.trim()) {
      return;
    }

    setEditSaving(true);
    try {
      await window.bookkeeping.tag.update({
        id: editingTag.id,
        name: editingTag.name.trim(),
        colorHex: editingTag.colorHex,
      });
      setEditingTag(null);
      await onRefresh();
    } finally {
      setEditSaving(false);
    }
  };

  const toggleTagSelection = (tagId: string) => {
    setSelectedTagIds((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const deleteSelectedCategories = async () => {
    if (selectedCategoryIds.length === 0) {
      return;
    }
    setDeleteIntent({ kind: 'category', ids: [...selectedCategoryIds] });
  };

  const deleteSelectedTags = async () => {
    if (selectedTagIds.length === 0) {
      return;
    }
    setDeleteIntent({ kind: 'tag', ids: [...selectedTagIds] });
  };

  const confirmDeleteSelection = async () => {
    if (!deleteIntent) {
      return;
    }
    setDeletePending(true);
    try {
      if (deleteIntent.kind === 'category') {
        for (const categoryId of deleteIntent.ids) {
          await window.bookkeeping.category.delete(categoryId);
        }
        setSelectedCategoryIds([]);
      } else {
        for (const tagId of deleteIntent.ids) {
          await window.bookkeeping.tag.delete(tagId);
        }
        setSelectedTagIds([]);
      }
      await onRefresh();
    } finally {
      setDeletePending(false);
      setDeleteIntent(null);
    }
  };

  const saveBudget = async () => {
    if (!newBudget.categoryId || !newBudget.amount) {
      return;
    }

    await window.bookkeeping.budget.upsert({
      categoryId: newBudget.categoryId,
      year: Number(newBudget.year),
      month: Number(newBudget.month),
      budgetCents: Math.round(Number(newBudget.amount) * 100),
    });

    setNewBudget((prev) => ({ ...prev, amount: '' }));
    await onRefresh();
  };

  const saveOverallBudget = async () => {
    const budgetCents = overallBudgetAmount.trim() ? Math.max(0, toCents(overallBudgetAmount)) : 0;
    await window.bookkeeping.settings.set({
      overallMonthlyBudgetCents: budgetCents,
    });
    setStatus(
      budgetCents > 0
        ? `Total monthly budget saved: ${formatCurrency(budgetCents)}`
        : 'Total monthly budget cleared. Dashboard now uses category totals.',
    );
    await onRefresh();
  };

  const exportBackup = async () => {
    const result = await window.bookkeeping.backup.exportZip();
    if (result?.canceled) {
      setStatus('Backup export canceled.');
      return;
    }
    setStatus(`Backup exported: ${result.outputPath}`);
  };

  const exportCustomCsv = async () => {
    if (selectedCustomCsvColumnCount === 0) {
      setStatus('Select at least one custom CSV column before exporting.');
      return;
    }

    setExportingCustomCsv(true);
    try {
      const result = await window.bookkeeping.backup.exportCustomCsv(customCsvColumns);
      if (result?.canceled) {
        setStatus('Custom CSV export canceled.');
        return;
      }
      setStatus(`Custom CSV exported: ${result.outputPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? `Custom CSV export failed: ${error.message}` : 'Custom CSV export failed.');
    } finally {
      setExportingCustomCsv(false);
    }
  };

  const importBackup = async () => {
    if (!importPath.trim()) {
      setStatus('Select a backup ZIP before importing.');
      return;
    }

    setImporting(true);
    try {
      setStatus('Validating backup...');
      const validation = await window.bookkeeping.backup.validateZip(importPath.trim());
      if (!validation.valid) {
        setStatus(`Import failed: ${validation.errors.join(', ')}`);
        return;
      }

      setStatus('Importing backup snapshot...');
      await window.bookkeeping.backup.importZip({ zipPath: importPath.trim() });
      setStatus('Import complete. New snapshot activated.');
      await onRefresh();
    } catch (importError) {
      setStatus(importError instanceof Error ? `Import failed: ${importError.message}` : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const chooseImportZip = async () => {
    const result = await window.bookkeeping.backup.pickImportZip();
    if (result?.canceled) {
      return;
    }
    if (result?.zipPath) {
      setImportPath(result.zipPath);
      setStatus(null);
    }
  };

  const switchSnapshot = async (snapshotId: string) => {
    await window.bookkeeping.backup.switchSnapshot(snapshotId);
    setStatus('Snapshot switched. Reloading data...');
    await onRefresh();
  };

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-200">Categories</h3>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void deleteSelectedCategories()}
            disabled={selectedCategoryIds.length === 0}
          >
            Delete Selected ({selectedCategoryIds.length})
          </Button>
        </div>
        <div className="mb-4 grid gap-2 md:grid-cols-3">
          <Input
            placeholder="Category name"
            value={newCategory.name}
            onChange={(event) => setNewCategory((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Select
            value={newCategory.parentId}
            onChange={(event) => setNewCategory((prev) => ({ ...prev, parentId: event.target.value }))}
          >
            <option value="">No parent</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id} style={{ color: category.colorHex }}>
                {category.name} ({category.colorHex})
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Input
              type="color"
              className="h-10 w-12 p-1"
              value={newCategory.colorHex}
              onChange={(event) => setNewCategory((prev) => ({ ...prev, colorHex: event.target.value }))}
            />
            <Button onClick={() => void createCategory()}>Add</Button>
          </div>
        </div>
        <div className="max-h-24 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Badge key={category.id} color={category.colorHex}>
                {category.name}
              </Badge>
            ))}
          </div>
        </div>
        <div className="mt-3 max-h-72 space-y-1.5 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
          {categories.map((category) => {
            const selected = selectedCategoryIds.includes(category.id);
            return (
              <div
                key={category.id}
                className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm ${
                  selected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-900'
                }`}
              >
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleCategorySelection(category.id)}
                    className="h-4 w-4 accent-neutral-400"
                  />
                  <span>{category.name}</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">{category.parentId ? 'Subcategory' : 'Category'}</span>
                  <Button variant="ghost" size="sm" onClick={() => startEditCategory(category)}>
                    Edit
                  </Button>
                </div>
              </div>
            );
          })}
          {categories.length === 0 ? <p className="text-xs text-neutral-500">No categories yet.</p> : null}
        </div>
        {editingCategory ? (
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Edit Category</div>
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                value={editingCategory.name}
                onChange={(event) => setEditingCategory((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                placeholder="Category name"
              />
              <Select
                value={editingCategory.parentId}
                onChange={(event) =>
                  setEditingCategory((prev) => (prev ? { ...prev, parentId: event.target.value } : prev))
                }
              >
                <option value="">No parent</option>
                {categories
                  .filter((category) => category.id !== editingCategory.id)
                  .map((category) => (
                    <option key={category.id} value={category.id} style={{ color: category.colorHex }}>
                      {category.name} ({category.colorHex})
                    </option>
                  ))}
              </Select>
              <Input
                type="color"
                className="h-10 w-12 p-1"
                value={editingCategory.colorHex}
                onChange={(event) =>
                  setEditingCategory((prev) => (prev ? { ...prev, colorHex: event.target.value } : prev))
                }
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={() => void saveEditedCategory()} disabled={editSaving || !editingCategory.name.trim()}>
                Save Category
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingCategory(null)} disabled={editSaving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        </Card>

        <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-200">Tags</h3>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void deleteSelectedTags()}
            disabled={selectedTagIds.length === 0}
          >
            Delete Selected ({selectedTagIds.length})
          </Button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input
            placeholder="Tag name"
            value={newTag.name}
            onChange={(event) => setNewTag((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Input
            type="color"
            className="h-10 w-12 p-1"
            value={newTag.colorHex}
            onChange={(event) => setNewTag((prev) => ({ ...prev, colorHex: event.target.value }))}
          />
          <Button onClick={() => void createTag()}>Add</Button>
        </div>
        <div className="max-h-24 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag.id} color={tag.colorHex}>
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
        <div className="mt-3 max-h-72 space-y-1.5 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
          {tags.map((tag) => {
            const selected = selectedTagIds.includes(tag.id);
            return (
              <div
                key={tag.id}
                className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm ${
                  selected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-900'
                }`}
              >
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleTagSelection(tag.id)}
                    className="h-4 w-4 accent-neutral-400"
                  />
                  <span>{tag.name}</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">{tag.colorHex}</span>
                  <Button variant="ghost" size="sm" onClick={() => startEditTag(tag)}>
                    Edit
                  </Button>
                </div>
              </div>
            );
          })}
          {tags.length === 0 ? <p className="text-xs text-neutral-500">No tags yet.</p> : null}
        </div>
        {editingTag ? (
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Edit Tag</div>
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                value={editingTag.name}
                onChange={(event) => setEditingTag((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                placeholder="Tag name"
              />
              <Input
                type="color"
                className="h-10 w-12 p-1"
                value={editingTag.colorHex}
                onChange={(event) => setEditingTag((prev) => (prev ? { ...prev, colorHex: event.target.value } : prev))}
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={() => void saveEditedTag()} disabled={editSaving || !editingTag.name.trim()}>
                Save Tag
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTag(null)} disabled={editSaving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        </Card>

        <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-200">Monthly Budgets</h3>
        <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3">
          <Label>Total Monthly Budget (All Categories)</Label>
          <p className="text-xs text-neutral-500">Used as the top-level budget in dashboard utilization.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              type="number"
              step="0.01"
              min={0}
              placeholder="0.00"
              value={overallBudgetAmount}
              onChange={(event) => setOverallBudgetAmount(event.target.value)}
              className="max-w-[220px]"
            />
            <Button onClick={() => void saveOverallBudget()}>Save Total Budget</Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <Select
            value={newBudget.categoryId}
            onChange={(event) => setNewBudget((prev) => ({ ...prev, categoryId: event.target.value }))}
          >
            <option value="">Select Category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id} style={{ color: category.colorHex }}>
                {category.name} ({category.colorHex})
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={2000}
            max={2200}
            value={newBudget.year}
            onChange={(event) => setNewBudget((prev) => ({ ...prev, year: Number(event.target.value) }))}
          />
          <Input
            type="number"
            min={1}
            max={12}
            value={newBudget.month}
            onChange={(event) => setNewBudget((prev) => ({ ...prev, month: Number(event.target.value) }))}
          />
          <Input
            type="number"
            step="0.01"
            placeholder="Budget"
            value={newBudget.amount}
            onChange={(event) => setNewBudget((prev) => ({ ...prev, amount: event.target.value }))}
          />
        </div>
        <div className="mt-2">
          <Button onClick={() => void saveBudget()}>Save Budget</Button>
        </div>

        <div className="mt-4 max-h-72 space-y-2 overflow-auto pr-1">
          {categories.map((category) => {
            const categoryBudgets = budgetsByCategory.get(category.id) ?? [];
            return (
              <div key={category.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
                <div className="mb-1">
                  <Badge color={category.colorHex}>{category.name}</Badge>
                </div>
                <div className="text-xs text-neutral-400">
                  {categoryBudgets.length > 0
                    ? categoryBudgets
                        .slice(0, 4)
                        .map((budget) => `${budget.year}-${String(budget.month).padStart(2, '0')}: ${formatCurrency(budget.budgetCents)}`)
                        .join(' | ')
                    : 'No budgets yet'}
                </div>
              </div>
            );
          })}
        </div>
        </Card>

        <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-200">Custom CSV Export</h3>
        <p className="text-xs text-neutral-500">Choose exactly which columns to include in your CSV export.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(Object.keys(customCsvColumnLabels) as Array<keyof typeof customCsvColumnLabels>).map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded border border-neutral-800 px-2 py-1.5 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={customCsvColumns[key]}
                onChange={() =>
                  setCustomCsvColumns((prev) => ({
                    ...prev,
                    [key]: !prev[key],
                  }))
                }
                className="h-4 w-4 accent-neutral-400"
              />
              <span>{customCsvColumnLabels[key]}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-500">{selectedCustomCsvColumnCount} column(s) selected</span>
          <Button
            onClick={() => void exportCustomCsv()}
            disabled={exportingCustomCsv || selectedCustomCsvColumnCount === 0}
          >
            {exportingCustomCsv ? 'Exporting...' : 'Export CSV'}
          </Button>
        </div>
        </Card>

        <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-200">Backup</h3>

        <div className="mb-3 flex flex-wrap gap-2">
          <Button onClick={() => void exportBackup()}>Export Full ZIP</Button>
        </div>

        <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-950/70 p-3">
          <Label>Import ZIP Snapshot</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              value={importPath}
              placeholder="Choose backup zip..."
              onChange={(event) => setImportPath(event.target.value)}
            />
            <Button variant="secondary" onClick={() => void chooseImportZip()} disabled={importing}>
              Choose ZIP
            </Button>
            <Button onClick={() => void importBackup()} disabled={importing}>
              {importing ? 'Importing...' : 'Import'}
            </Button>
          </div>
        </div>

        <div>
          <Label>Snapshots</Label>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
                <div>
                  <div className="text-sm text-neutral-200">{snapshot.label}</div>
                  <div className="text-xs text-neutral-500">{dayjs(snapshot.createdAt).format('MMM D, YYYY h:mm A')}</div>
                </div>
                <div className="flex gap-2">
                  {snapshot.isActive ? <Badge>Active</Badge> : null}
                  {!snapshot.isActive ? (
                    <Button variant="ghost" size="sm" onClick={() => void switchSnapshot(snapshot.id)}>
                      Activate
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {status ? <p className="mt-3 text-xs text-neutral-400">{status}</p> : null}
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(deleteIntent)}
        title={deleteIntent?.kind === 'category' ? 'Delete Categories' : 'Delete Tags'}
        description={
          deleteIntent
            ? `Delete ${deleteIntent.ids.length} selected ${deleteIntent.kind}${deleteIntent.ids.length === 1 ? '' : 's'} permanently?`
            : 'Delete selected items?'
        }
        confirmLabel="Delete"
        loading={deletePending}
        onCancel={() => setDeleteIntent(null)}
        onConfirm={() => void confirmDeleteSelection()}
      />
    </>
  );
}
