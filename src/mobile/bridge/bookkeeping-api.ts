import type {
  AppSettings,
  BudgetInput,
  CategoryInput,
  ExportCustomCsvRequest,
  ExportRequest,
  ImportRequest,
  OCRRequest,
  PurchaseCreateInput,
  PurchaseFilterInput,
  PurchaseTimelineQuery,
  PurchaseUpdateInput,
  TagInput,
  BookkeepingPreloadApi,
} from '@shared';
import { AppServices } from '../services/app-services';
import { joinPath } from '../lib/path';

let servicesPromise: Promise<AppServices> | null = null;

function getServices() {
  if (!servicesPromise) {
    servicesPromise = AppServices.create();
  }
  return servicesPromise;
}

const quickAddEventName = 'app.quickAdd';

export function emitQuickAdd() {
  window.dispatchEvent(new CustomEvent(quickAddEventName));
}

function createApi(): BookkeepingPreloadApi {
  const normalizeImages = (images: PurchaseCreateInput['images']) =>
    (images ?? []).map((image) => ({
      fileName: String(image.fileName ?? ''),
      mimeType: String(image.mimeType ?? ''),
      base64Data: String(image.base64Data ?? ''),
    }));

  return {
    purchase: {
      async create(payload: PurchaseCreateInput) {
        const services = await getServices();
        const purchase = await services.db.createPurchase(payload);

        let ocrResults: unknown[] = [];
        const normalizedImages = normalizeImages(payload.images);
        if (normalizedImages.length > 0) {
          const images = await services.media.addImages(purchase.id, normalizedImages);
          ocrResults = await Promise.all(images.map((image) => services.ocr.extractByImageId(image.id)));
        }

        return {
          purchase: services.db.getPurchaseOrThrow(purchase.id),
          ocrResults,
        };
      },
      async update(payload: PurchaseUpdateInput) {
        const services = await getServices();
        return services.db.updatePurchase(payload);
      },
      async delete(id: string) {
        const services = await getServices();
        await services.db.deletePurchase(id);
        return { success: true };
      },
      async get(id: string) {
        const services = await getServices();
        return services.db.getPurchase(id);
      },
      async list(filter: PurchaseFilterInput) {
        const services = await getServices();
        return services.db.listPurchases(filter);
      },
      async timeline(query: PurchaseTimelineQuery) {
        const services = await getServices();
        return services.db.listTimeline(query);
      },
    },
    purchaseImages: {
      async add(payload: { purchaseId: string; images: PurchaseCreateInput['images'] }) {
        const services = await getServices();
        const created = await services.media.addImages(payload.purchaseId, normalizeImages(payload.images));
        const ocrResults = await Promise.all(created.map((image) => services.ocr.extractByImageId(image.id)));
        return {
          images: services.db.listImagesByPurchase(payload.purchaseId),
          ocrResults,
        };
      },
      async remove(imageId: string) {
        const services = await getServices();
        const removed = await services.media.removeImage(imageId);
        return { removed };
      },
      async list(purchaseId: string) {
        const services = await getServices();
        return services.db.listImagesByPurchase(purchaseId);
      },
    },
    ocr: {
      async extract(payload: OCRRequest) {
        const services = await getServices();
        return services.ocr.extractByImageId(payload.imageId);
      },
      async reextract(payload: OCRRequest) {
        const services = await getServices();
        return services.ocr.extractByImageId(payload.imageId);
      },
      async preview(payload: { base64Data: string }) {
        const services = await getServices();
        return services.ocr.previewFromBase64(payload.base64Data);
      },
    },
    category: {
      async create(payload: CategoryInput) {
        const services = await getServices();
        return services.db.createCategory(payload);
      },
      async update(payload: CategoryInput) {
        const services = await getServices();
        return services.db.createCategory(payload);
      },
      async delete(id: string) {
        const services = await getServices();
        await services.db.deleteCategory(id);
        return { success: true };
      },
      async list() {
        const services = await getServices();
        return services.db.listCategories();
      },
    },
    tag: {
      async create(payload: TagInput) {
        const services = await getServices();
        return services.db.createTag(payload);
      },
      async update(payload: TagInput) {
        const services = await getServices();
        return services.db.createTag(payload);
      },
      async delete(id: string) {
        const services = await getServices();
        await services.db.deleteTag(id);
        return { success: true };
      },
      async list() {
        const services = await getServices();
        return services.db.listTags();
      },
    },
    budget: {
      async upsert(payload: BudgetInput) {
        const services = await getServices();
        return services.db.upsertBudget(payload);
      },
      async list(payload?: { year?: number; month?: number }) {
        const services = await getServices();
        return services.db.listBudgets(payload?.year, payload?.month);
      },
      async vsActual(payload: { year: number; month: number }) {
        const services = await getServices();
        return services.db.getBudgetVsActual(payload.year, payload.month);
      },
    },
    analytics: {
      async dashboard(payload?: { anchorDate?: string }) {
        const services = await getServices();
        return services.db.getDashboardSummary(payload?.anchorDate);
      },
      async monthly(payload?: { fromDate?: string; toDate?: string }) {
        const services = await getServices();
        const now = new Date();
        const fromDate =
          payload?.fromDate ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const toDate = payload?.toDate ?? now.toISOString().slice(0, 10);
        return services.db.getCategoryBreakdown(fromDate, toDate);
      },
      async yearly(payload?: { year?: number }) {
        const services = await getServices();
        const year = payload?.year ?? new Date().getFullYear();
        return services.db.getCategoryBreakdown(`${year}-01-01`, `${year}-12-31`);
      },
      async trends(payload?: { fromDate?: string; toDate?: string; bucket?: 'daily' | 'weekly' }) {
        const services = await getServices();
        const now = new Date();
        const fromDate = payload?.fromDate ?? `${now.getFullYear()}-01-01`;
        const toDate = payload?.toDate ?? now.toISOString().slice(0, 10);
        return services.db.getSpendingTrends(fromDate, toDate, payload?.bucket ?? 'daily');
      },
    },
    backup: {
      async exportZip(payload?: ExportRequest) {
        const services = await getServices();
        const result = await services.backup.exportZip(payload ?? {});
        return { ...result, canceled: false };
      },
      async exportCustomCsv(payload: ExportCustomCsvRequest) {
        const services = await getServices();
        const result = await services.backup.exportCustomCsv(payload);
        return { ...result, canceled: false };
      },
      async pickImportZip() {
        const services = await getServices();
        return services.backup.pickImportZip();
      },
      async validateZip(zipPath: string) {
        const services = await getServices();
        return services.backup.validateZip(zipPath);
      },
      async importZip(payload: ImportRequest) {
        const services = await getServices();
        return services.backup.importZip(payload);
      },
      async listSnapshots() {
        const services = await getServices();
        return services.db.listSnapshots();
      },
      async switchSnapshot(snapshotId: string) {
        const services = await getServices();
        await services.db.switchSnapshot(snapshotId);
        return { success: true };
      },
    },
    settings: {
      async get() {
        const services = await getServices();
        return services.db.getSettings();
      },
      async set(payload: Partial<AppSettings>) {
        const services = await getServices();
        return services.db.updateSettings(payload);
      },
    },
    media: {
      async resolvePath(relativePath: string) {
        const services = await getServices();
        return joinPath(services.db.getActiveMediaRoot(), relativePath);
      },
      async readDataUrl(payload: { relativePath: string; mimeType?: string }) {
        const services = await getServices();
        const base64 = await services.media.readImageBase64(payload.relativePath);
        const mimeType =
          typeof payload.mimeType === 'string' && payload.mimeType.trim().length > 0
            ? payload.mimeType.trim()
            : 'application/octet-stream';
        return `data:${mimeType};base64,${base64}`;
      },
    },
    windowControls: {
      async minimize() {
        return { success: true };
      },
      async toggleMaximize() {
        return { maximized: false };
      },
      async isMaximized() {
        return { maximized: false };
      },
      async close() {
        return { success: true };
      },
    },
    quickAdd: {
      onOpen(callback: () => void) {
        const listener = () => callback();
        window.addEventListener(quickAddEventName, listener);
        return () => window.removeEventListener(quickAddEventName, listener);
      },
    },
  };
}

export async function attachBookkeepingApi() {
  if ((window as any).bookkeeping) {
    return;
  }
  await getServices();
  (window as any).bookkeeping = createApi();
}
