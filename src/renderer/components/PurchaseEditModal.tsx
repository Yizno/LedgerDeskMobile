import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { CategoryRecord, PurchaseRecord, TagRecord } from '@shared';
import { fromCents, toCents, toLocalIsoDate } from '../lib/format';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Modal } from './ui/modal';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';

type Props = {
  open: boolean;
  purchase: PurchaseRecord | null;
  categories: CategoryRecord[];
  tags: TagRecord[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

type FormState = {
  name: string;
  amount: string;
  purchaseDate: string;
  vendor: string;
  notes: string;
  categoryId: string;
  tagIds: string[];
};

const emptyForm: FormState = {
  name: '',
  amount: '',
  purchaseDate: toLocalIsoDate(),
  vendor: '',
  notes: '',
  categoryId: '',
  tagIds: [],
};

export function PurchaseEditModal({ open, purchase, categories, tags, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [images, setImages] = useState<PurchaseRecord['images']>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
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
  const [saving, setSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [pendingRemovedImageIds, setPendingRemovedImageIds] = useState<string[]>([]);
  const [pendingAddedImages, setPendingAddedImages] = useState<PendingImageDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeCategories = useMemo(
    () => availableCategories.filter((category) => !category.isArchived),
    [availableCategories],
  );
  const selectedCategory = useMemo(
    () => activeCategories.find((category) => category.id === form.categoryId) ?? null,
    [activeCategories, form.categoryId],
  );
  const visibleImages = useMemo(
    () => images.filter((image) => !pendingRemovedImageIds.includes(image.id)),
    [images, pendingRemovedImageIds],
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

  useEffect(() => {
    if (!purchase || !open) {
      return;
    }

    setForm({
      name: purchase.name,
      amount: fromCents(purchase.amountCents),
      purchaseDate: purchase.purchaseDate,
      vendor: purchase.vendor ?? '',
      notes: purchase.notes ?? '',
      categoryId: purchase.categoryId ?? '',
      tagIds: purchase.tags.map((tag) => tag.id),
    });
    setImages(purchase.images);
    setEditingTagId(null);
    setEditingTagName('');
    setEditingTagColor('#737373');
    setNewCategoryName('');
    setNewCategoryColor('#737373');
    setShowNewCategoryForm(false);
    setNewTagName('');
    setNewTagColor('#737373');
    setShowNewTagForm(false);
    setPendingRemovedImageIds([]);
    setPendingAddedImages([]);
    setError(null);
  }, [open, purchase]);

  useEffect(() => {
    if (!open || images.length === 0) {
      setImageUrls({});
      return;
    }

    let active = true;
    void Promise.allSettled(
      images.map(async (image) => {
        const dataUrl = await window.bookkeeping.media.readDataUrl({
          relativePath: image.relativePath,
          mimeType: image.mimeType,
        });
        return [image.id, dataUrl] as const;
      }),
    ).then((results) => {
      if (!active) {
        return;
      }

      const pairs = results
        .filter((result): result is PromiseFulfilledResult<readonly [string, string]> => result.status === 'fulfilled')
        .map((result) => result.value);

      setImageUrls(Object.fromEntries(pairs));
    });

    return () => {
      active = false;
    };
  }, [images, open]);

  const toggleTag = (tagId: string) => {
    setForm((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
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
      await onSaved();
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : 'Failed to create tag.');
    } finally {
      setTagSaving(false);
    }
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
      await onSaved();
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : 'Failed to create category.');
    } finally {
      setCategorySaving(false);
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
      await onSaved();
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : 'Failed to update tag.');
    } finally {
      setTagSaving(false);
    }
  };

  const onFilesSelected = async (files: FileList | null) => {
    if (!purchase || !files || files.length === 0) {
      return;
    }

    setUploadingImages(true);
    setError(null);
    try {
      const converted = await Promise.all(Array.from(files).map(fileToImageDraft));
      queueAddedImages(converted);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to add images.');
    } finally {
      setUploadingImages(false);
    }
  };

  const addFromCamera = async () => {
    if (!purchase) {
      return;
    }

    setUploadingImages(true);
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

      queueAddedImages([
        {
          fileName: `camera-${Date.now()}.${photo.format ?? 'jpeg'}`,
          mimeType: `image/${photo.format ?? 'jpeg'}`,
          base64Data: photo.base64String,
        },
      ]);
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : 'Failed to capture image.');
    } finally {
      setUploadingImages(false);
    }
  };

  const addFromPhotos = async () => {
    if (!purchase) {
      return;
    }

    setUploadingImages(true);
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

      queueAddedImages([
        {
          fileName: `gallery-${Date.now()}.${photo.format ?? 'jpeg'}`,
          mimeType: `image/${photo.format ?? 'jpeg'}`,
          base64Data: photo.base64String,
        },
      ]);
    } catch (photosError) {
      setError(photosError instanceof Error ? photosError.message : 'Failed to import photo.');
    } finally {
      setUploadingImages(false);
    }
  };

  const queueAddedImages = (drafts: ImageDraft[]) => {
    setPendingAddedImages((prev) => [
      ...prev,
      ...drafts.map((draft) => ({
        id: createDraftId(),
        ...draft,
        previewUrl: toPreviewUrl(draft),
      })),
    ]);
  };

  const removeImage = (imageId: string) => {
    setPendingRemovedImageIds((prev) => (prev.includes(imageId) ? prev : [...prev, imageId]));
  };

  const removePendingAddedImage = (imageId: string) => {
    setPendingAddedImages((prev) => prev.filter((image) => image.id !== imageId));
  };

  const save = async () => {
    if (!purchase) {
      return;
    }

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
      await window.bookkeeping.purchase.update({
        id: purchase.id,
        name: form.name.trim(),
        amountCents: toCents(form.amount),
        purchaseDate: form.purchaseDate,
        vendor: form.vendor || null,
        notes: form.notes || null,
        categoryId: form.categoryId || null,
        tagIds: form.tagIds,
      });
      if (pendingAddedImages.length > 0) {
        await window.bookkeeping.purchaseImages.add({
          purchaseId: purchase.id,
          images: pendingAddedImages.map((image) => ({
            fileName: image.fileName,
            mimeType: image.mimeType,
            base64Data: image.base64Data,
          })),
        });
      }
      for (const imageId of pendingRemovedImageIds) {
        await window.bookkeeping.purchaseImages.remove(imageId);
      }
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Edit Purchase" onClose={onClose} className="max-w-4xl">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
        </div>
        <div>
          <Label>Amount</Label>
          <Input
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
          />
        </div>

        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={form.purchaseDate}
            onChange={(event) => setForm((prev) => ({ ...prev, purchaseDate: event.target.value }))}
          />
        </div>
        <div>
          <Label>Vendor</Label>
          <Input value={form.vendor} onChange={(event) => setForm((prev) => ({ ...prev, vendor: event.target.value }))} />
        </div>

        <div className="md:col-span-2">
          <Label>Category</Label>
          <Select
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
          <Label>Notes</Label>
          <Textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
        </div>

        <div className="md:col-span-2">
          <Label>Receipt Images</Label>
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 md:grid-cols-4">
            {visibleImages.map((image) => (
              <div key={image.id} className="group relative overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900">
                {imageUrls[image.id] ? (
                  <img
                    src={imageUrls[image.id]}
                    alt={image.originalName}
                    className="h-28 w-full object-cover"
                  />
                ) : (
                  <div className="grid h-28 place-items-center text-xs text-neutral-500">Loading...</div>
                )}
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-md border border-neutral-700 bg-neutral-900/90 p-1 text-neutral-200 transition hover:border-neutral-400"
                  onClick={() => void removeImage(image.id)}
                  title="Delete image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="truncate border-t border-neutral-800 px-2 py-1 text-[10px] text-neutral-400">
                  {image.originalName}
                </div>
              </div>
            ))}
            {pendingAddedImages.map((image) => (
              <div key={image.id} className="group relative overflow-hidden rounded-lg border border-emerald-700/60 bg-neutral-900">
                <img src={image.previewUrl} alt={image.fileName} className="h-28 w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-md border border-neutral-700 bg-neutral-900/90 p-1 text-neutral-200 transition hover:border-neutral-400"
                  onClick={() => removePendingAddedImage(image.id)}
                  title="Remove queued image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="truncate border-t border-neutral-800 px-2 py-1 text-[10px] text-emerald-300">
                  {image.fileName}
                </div>
              </div>
            ))}
            <div className="grid h-[132px] gap-1 rounded-lg border border-dashed border-neutral-600 bg-neutral-900/40 p-1 text-neutral-300">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-full text-xs"
                onClick={() => void addFromCamera()}
                disabled={uploadingImages}
              >
                Capture
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-full text-xs"
                onClick={() => void addFromPhotos()}
                disabled={uploadingImages}
              >
                Gallery
              </Button>
              <label className="flex h-full cursor-pointer items-center justify-center rounded-md border border-dashed border-neutral-600 bg-neutral-900/50 px-2 text-xs transition hover:border-neutral-400">
                Files
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                  multiple
                  onChange={(event) => {
                    void onFilesSelected(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          {pendingRemovedImageIds.length > 0 ? (
            <div className="mt-2 flex items-center justify-between text-xs text-neutral-400">
              <span>{pendingRemovedImageIds.length} image(s) will be deleted when you save.</span>
              <Button size="sm" variant="ghost" onClick={() => setPendingRemovedImageIds([])}>
                Undo
              </Button>
            </div>
          ) : null}
          {pendingAddedImages.length > 0 ? (
            <div className="mt-2 flex items-center justify-between text-xs text-neutral-400">
              <span>{pendingAddedImages.length} image(s) will be added when you save.</span>
              <Button size="sm" variant="ghost" onClick={() => setPendingAddedImages([])}>
                Clear
              </Button>
            </div>
          ) : null}
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

        {error ? <p className="md:col-span-2 text-sm text-neutral-300">{error}</p> : null}

        <div className="md:col-span-2 mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saving || uploadingImages || tagSaving || categorySaving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || uploadingImages || tagSaving || categorySaving}
            className="w-full sm:w-auto"
          >
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type ImageDraft = {
  fileName: string;
  mimeType: string;
  base64Data: string;
};

type PendingImageDraft = ImageDraft & {
  id: string;
  previewUrl: string;
};

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

function toPreviewUrl(image: ImageDraft): string {
  const mimeType = image.mimeType?.trim() ? image.mimeType : 'image/jpeg';
  return `data:${mimeType};base64,${image.base64Data}`;
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
