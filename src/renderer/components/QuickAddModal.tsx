import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, UploadCloud, X } from 'lucide-react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { CategoryRecord, PurchaseCreateInput, TagRecord } from '@shared';
import { fromCents, toCents, toLocalIsoDate } from '../lib/format';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Modal } from './ui/modal';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';

type OCRPreview = {
  amountCandidateCents: number | null;
  dateCandidate: string | null;
  vendorCandidate: string | null;
  confidence: {
    amount: number;
    date: number;
    vendor: number;
    overall: number;
  };
};

type Props = {
  open: boolean;
  categories: CategoryRecord[];
  tags: TagRecord[];
  onClose: () => void;
  onCreated: () => Promise<void>;
};

type ImageDraft = {
  fileName: string;
  mimeType: string;
  base64Data: string;
};

const defaultForm = {
  name: '',
  amount: '',
  purchaseDate: toLocalIsoDate(),
  vendor: '',
  notes: '',
  categoryId: '',
  tagIds: [] as string[],
};

export function QuickAddModal({ open, categories, tags, onClose, onCreated }: Props) {
  const [form, setForm] = useState(defaultForm);
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [availableCategories, setAvailableCategories] = useState<CategoryRecord[]>(categories);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#737373');
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [availableTags, setAvailableTags] = useState<TagRecord[]>(tags);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#737373');
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [editingTagColor, setEditingTagColor] = useState('#737373');
  const [tagSaving, setTagSaving] = useState(false);
  const [ocrPreview, setOcrPreview] = useState<OCRPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const activeCategories = useMemo(
    () => availableCategories.filter((category) => !category.isArchived),
    [availableCategories],
  );
  const selectedCategory = useMemo(
    () => activeCategories.find((category) => category.id === form.categoryId) ?? null,
    [activeCategories, form.categoryId],
  );
  useEffect(() => {
    setAvailableCategories(categories);
  }, [categories]);
  useEffect(() => {
    setAvailableTags(tags);
  }, [tags]);

  const upsertLocalCategory = (category: CategoryRecord) => {
    setAvailableCategories((prev) => {
      const exists = prev.some((item) => item.id === category.id);
      const next = exists ? prev.map((item) => (item.id === category.id ? category : item)) : [...prev, category];
      return [...next].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const upsertLocalTag = (tag: TagRecord) => {
    setAvailableTags((prev) => {
      const exists = prev.some((item) => item.id === tag.id);
      const next = exists ? prev.map((item) => (item.id === tag.id ? tag : item)) : [...prev, tag];
      return [...next].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const closeAndReset = () => {
    setForm(defaultForm);
    setImages([]);
    setNewCategoryName('');
    setNewCategoryColor('#737373');
    setShowNewCategoryForm(false);
    setNewTagName('');
    setShowNewTagForm(false);
    setEditingTagId(null);
    setEditingTagName('');
    setEditingTagColor('#737373');
    setOcrPreview(null);
    setError(null);
    onClose();
  };

  const applySelectedImages = async (converted: ImageDraft[]) => {
    if (converted.length === 0) {
      return;
    }

    setImages((prev) => [...prev, ...converted]);

    const first = converted[0];
    if (!first) {
      return;
    }

    setExtracting(true);
    setError(null);
    try {
      const preview = await window.bookkeeping.ocr.preview({ base64Data: first.base64Data });
      setOcrPreview(preview);
      setForm((prev) => ({
        ...prev,
        amount: prev.amount || (preview.amountCandidateCents ? fromCents(preview.amountCandidateCents) : prev.amount),
        purchaseDate: prev.purchaseDate || preview.dateCandidate || prev.purchaseDate,
        vendor: prev.vendor || preview.vendorCandidate || prev.vendor,
      }));
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : 'OCR preview failed.');
    } finally {
      setExtracting(false);
    }
  };

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const converted = await Promise.all(Array.from(files).map(fileToImageDraft));
    await applySelectedImages(converted);
  };

  const addFromCamera = async () => {
    setError(null);
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        quality: 92,
      });

      if (!photo.base64String) {
        return;
      }

      const draft: ImageDraft = {
        fileName: `camera-${Date.now()}.${photo.format ?? 'jpeg'}`,
        mimeType: `image/${photo.format ?? 'jpeg'}`,
        base64Data: photo.base64String,
      };

      await applySelectedImages([draft]);
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : 'Camera capture failed.');
    }
  };

  const addFromPhotos = async () => {
    setError(null);
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Photos,
        quality: 92,
      });

      if (!photo.base64String) {
        return;
      }

      const draft: ImageDraft = {
        fileName: `gallery-${Date.now()}.${photo.format ?? 'jpeg'}`,
        mimeType: `image/${photo.format ?? 'jpeg'}`,
        base64Data: photo.base64String,
      };

      await applySelectedImages([draft]);
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : 'Photo library selection failed.');
    }
  };

  const toggleTag = (tagId: string) => {
    setForm((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
  };

  const removeImageDraft = (indexToRemove: number) => {
    setImages((prev) => {
      const next = prev.filter((_, index) => index !== indexToRemove);
      if (next.length === 0) {
        setOcrPreview(null);
      }
      return next;
    });
  };

  const addCategoryInline = async () => {
    if (!newCategoryName.trim()) {
      return;
    }

    setCategorySaving(true);
    setError(null);
    try {
      const created = await window.bookkeeping.category.create({
        name: newCategoryName.trim(),
        colorHex: newCategoryColor,
        parentId: null,
        isArchived: false,
      });
      upsertLocalCategory(created);
      setForm((prev) => ({ ...prev, categoryId: created.id }));
      setNewCategoryName('');
      setNewCategoryColor('#737373');
      setShowNewCategoryForm(false);
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : 'Failed to create category.');
    } finally {
      setCategorySaving(false);
    }
  };

  const startTagEdit = (tag: TagRecord) => {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
    setEditingTagColor(tag.colorHex);
  };

  const addTagInline = async () => {
    if (!newTagName.trim()) {
      return;
    }

    setTagSaving(true);
    setError(null);
    try {
      const created = await window.bookkeeping.tag.create({
        name: newTagName.trim(),
        colorHex: newTagColor,
      });
      upsertLocalTag(created);
      setForm((prev) => ({
        ...prev,
        tagIds: prev.tagIds.includes(created.id) ? prev.tagIds : [...prev.tagIds, created.id],
      }));
      setNewTagName('');
      setNewTagColor('#737373');
      setShowNewTagForm(false);
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : 'Failed to create tag.');
    } finally {
      setTagSaving(false);
    }
  };

  const saveTagInline = async () => {
    if (!editingTagId || !editingTagName.trim()) {
      return;
    }

    setTagSaving(true);
    setError(null);
    try {
      const updated = await window.bookkeeping.tag.update({
        id: editingTagId,
        name: editingTagName.trim(),
        colorHex: editingTagColor,
      });
      upsertLocalTag(updated);
      setEditingTagId(null);
      setEditingTagName('');
      setEditingTagColor('#737373');
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : 'Failed to update tag.');
    } finally {
      setTagSaving(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }

    if (!form.amount.trim()) {
      setError('Amount is required.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: PurchaseCreateInput = {
        name: form.name.trim(),
        amountCents: toCents(form.amount),
        purchaseDate: form.purchaseDate,
        vendor: form.vendor || null,
        notes: form.notes || null,
        categoryId: form.categoryId || null,
        tagIds: form.tagIds,
        images,
      };

      await window.bookkeeping.purchase.create(payload);
      await onCreated();
      closeAndReset();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create purchase.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Quick Add Purchase" onClose={closeAndReset} className="max-w-4xl">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="qa-name">Name</Label>
          <Input id="qa-name" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
        </div>
        <div>
          <Label htmlFor="qa-amount">Amount</Label>
          <Input
            id="qa-amount"
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="qa-date">Date</Label>
          <Input
            id="qa-date"
            type="date"
            value={form.purchaseDate}
            onChange={(event) => setForm((prev) => ({ ...prev, purchaseDate: event.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="qa-vendor">Vendor</Label>
          <Input
            id="qa-vendor"
            value={form.vendor}
            onChange={(event) => setForm((prev) => ({ ...prev, vendor: event.target.value }))}
          />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="qa-category">Category</Label>
          <Select
            id="qa-category"
            value={form.categoryId}
            onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}
          >
            <option value="">Uncategorized</option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id} style={{ color: category.colorHex }}>
                {category.name} ({category.colorHex})
              </option>
            ))}
          </Select>
          {selectedCategory ? (
            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-400">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedCategory.colorHex }} />
              {selectedCategory.name}
            </div>
          ) : null}
          {!showNewCategoryForm ? (
            <div className="mt-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewCategoryForm(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Category
              </Button>
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
              <div className="mb-2 text-xs text-neutral-400">New Category</div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    placeholder="Category name"
                  />
                </div>
                <Input
                  type="color"
                  className="h-10 w-12 p-1"
                  value={newCategoryColor}
                  onChange={(event) => setNewCategoryColor(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void addCategoryInline()}
                  disabled={categorySaving || !newCategoryName.trim()}
                >
                  Add Category
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowNewCategoryForm(false);
                    setNewCategoryName('');
                    setNewCategoryColor('#737373');
                  }}
                  disabled={categorySaving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="qa-notes">Notes</Label>
          <Textarea
            id="qa-notes"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>

        <div className="md:col-span-2">
          <Label>Tags</Label>
          <div className="max-h-36 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/70 p-3">
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => {
                const selected = form.tagIds.includes(tag.id);
                return (
                  <div
                    key={tag.id}
                    className={`inline-flex overflow-hidden rounded-full border text-xs ${
                      selected
                        ? 'border-neutral-200 bg-neutral-200 text-neutral-900'
                        : 'border-neutral-700 bg-neutral-900 text-neutral-200'
                    }`}
                  >
                    <button
                      type="button"
                      className="px-2.5 py-1 transition hover:bg-black/10"
                      onClick={() => toggleTag(tag.id)}
                    >
                      {tag.name}
                    </button>
                    <button
                      type="button"
                      className={`border-l px-2 transition ${
                        selected ? 'border-neutral-400/70 hover:bg-black/10' : 'border-neutral-700 hover:bg-neutral-800'
                      }`}
                      onClick={() => startTagEdit(tag)}
                      title="Edit tag"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              {availableTags.length === 0 ? <p className="text-xs text-neutral-500">No tags yet.</p> : null}
            </div>
          </div>
          {!showNewTagForm ? (
            <div className="mt-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewTagForm(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Tag
              </Button>
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
              <div className="mb-2 text-xs text-neutral-400">New Tag</div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="Tag name" />
                </div>
                <Input
                  type="color"
                  className="h-10 w-12 p-1"
                  value={newTagColor}
                  onChange={(event) => setNewTagColor(event.target.value)}
                />
                <Button type="button" size="sm" onClick={() => void addTagInline()} disabled={tagSaving || !newTagName.trim()}>
                  Add Tag
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowNewTagForm(false);
                    setNewTagName('');
                    setNewTagColor('#737373');
                  }}
                  disabled={tagSaving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {editingTagId ? (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
              <div className="mb-2 text-xs text-neutral-400">Edit Tag</div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={editingTagName}
                  onChange={(event) => setEditingTagName(event.target.value)}
                />
                <Input
                  type="color"
                  className="h-10 w-12 p-1"
                  value={editingTagColor}
                  onChange={(event) => setEditingTagColor(event.target.value)}
                />
                <Button size="sm" onClick={() => void saveTagInline()} disabled={tagSaving || !editingTagName.trim()}>
                  Save Tag
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingTagId(null);
                    setEditingTagName('');
                    setEditingTagColor('#737373');
                  }}
                  disabled={tagSaving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {tagSaving ? (
            <div className="mt-2 text-xs text-neutral-400">
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
              Saving tag...
            </div>
          ) : null}
        </div>

        <div className="md:col-span-2">
          <Label>Receipt Images</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button type="button" variant="secondary" onClick={() => void addFromCamera()}>
              Capture
            </Button>
            <Button type="button" variant="secondary" onClick={() => void addFromPhotos()}>
              Gallery
            </Button>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-600 bg-neutral-950 p-3 text-sm text-neutral-300 hover:border-neutral-400">
              <UploadCloud className="h-4 w-4" />
              Files
              <input
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                multiple
                onChange={(event) => void onFilesSelected(event.target.files)}
              />
            </label>
          </div>
          {images.length > 0 ? (
            <div className="mt-2 grid max-h-72 grid-cols-2 gap-2 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 md:grid-cols-4">
              {images.map((image, index) => (
                <div key={`${image.fileName}-${image.base64Data.slice(0, 12)}-${index}`} className="group relative overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900">
                  <img
                    src={`data:${image.mimeType};base64,${image.base64Data}`}
                    alt={image.fileName}
                    className="h-24 w-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-md border border-neutral-700 bg-neutral-900/90 p-1 text-neutral-200 transition hover:border-neutral-400"
                    onClick={() => removeImageDraft(index)}
                    title="Remove image"
                    aria-label={`Remove ${image.fileName}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="truncate border-t border-neutral-800 px-2 py-1 text-[10px] text-neutral-400">
                    {image.fileName}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {extracting ? (
          <div className="md:col-span-2 rounded-xl border border-neutral-700 bg-neutral-950/80 p-3 text-sm text-neutral-300">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Running OCR suggestions...
          </div>
        ) : null}

        {ocrPreview ? (
          <div className="md:col-span-2 rounded-xl border border-neutral-700 bg-neutral-900/40 p-3 text-sm text-neutral-200">
            <div className="mb-2 font-semibold">OCR Suggestions (confirm/edit before saving)</div>
            <div className="grid gap-2 text-xs md:grid-cols-3">
              <div>
                <span className="text-neutral-300">Amount:</span>{' '}
                {ocrPreview.amountCandidateCents ? fromCents(ocrPreview.amountCandidateCents) : 'N/A'}
              </div>
              <div>
                <span className="text-neutral-300">Date:</span> {ocrPreview.dateCandidate ?? 'N/A'}
              </div>
              <div>
                <span className="text-neutral-300">Vendor:</span> {ocrPreview.vendorCandidate ?? 'N/A'}
              </div>
            </div>
          </div>
        ) : null}

        {error ? <p className="md:col-span-2 text-sm text-neutral-300">{error}</p> : null}

        <div className="md:col-span-2 mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            variant="ghost"
            onClick={closeAndReset}
            disabled={saving || extracting || tagSaving || categorySaving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || extracting || tagSaving || categorySaving}
            className="w-full sm:w-auto"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Purchase
          </Button>
        </div>
      </div>
    </Modal>
  );
}

async function fileToImageDraft(file: File): Promise<ImageDraft> {
  const base64Data = await toBase64(file);
  return {
    fileName: file.name,
    mimeType: file.type || 'image/jpeg',
    base64Data,
  };
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const [, base64] = result.split(',');
      resolve(base64 ?? '');
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}
