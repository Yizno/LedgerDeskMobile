import { Directory, Filesystem } from '@capacitor/filesystem';
import { nanoid } from 'nanoid';
import type { PurchaseImageRecord } from '@shared';
import { dirname, joinPath } from '../lib/path';
import { DatabaseService } from './database.service';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const maxImageBytes = 15 * 1024 * 1024;

const mimeToExtension: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export type ImageInput = {
  fileName: string;
  mimeType: string;
  base64Data: string;
};

async function ensureDir(path: string) {
  try {
    await Filesystem.mkdir({
      path,
      directory: Directory.Data,
      recursive: true,
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (code === 'OS-PLUG-FILE-0010' || /already exists/i.test(message)) {
      return;
    }
    throw error;
  }
}

async function getImageDimensions(mimeType: string, base64Data: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width ?? null, height: img.height ?? null });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = `data:${mimeType};base64,${base64Data}`;
  });
}

function estimateBase64Size(base64Data: string) {
  const stripped = base64Data.replace(/=+$/, '');
  return Math.ceil((stripped.length * 3) / 4);
}

export class MediaService {
  constructor(private readonly dbService: DatabaseService) {}

  async addImages(purchaseId: string, files: ImageInput[]): Promise<PurchaseImageRecord[]> {
    const created: PurchaseImageRecord[] = [];

    for (const file of files) {
      if (!allowedMimeTypes.has(file.mimeType)) {
        throw new Error(`Unsupported image type: ${file.mimeType}`);
      }

      const sizeBytes = estimateBase64Size(file.base64Data);
      if (sizeBytes > maxImageBytes) {
        throw new Error(`Image ${file.fileName} exceeds 15MB size limit.`);
      }

      const meta = await getImageDimensions(file.mimeType, file.base64Data);
      const imageId = nanoid(12);
      const ext = mimeToExtension[file.mimeType] ?? 'jpg';
      const relativePath = joinPath(purchaseId, `${imageId}.${ext}`);
      const absolutePath = joinPath(this.dbService.getActiveMediaRoot(), relativePath);

      await ensureDir(dirname(absolutePath));
      await Filesystem.writeFile({
        path: absolutePath,
        directory: Directory.Data,
        data: file.base64Data,
      });

      await this.dbService.addImageRecord({
        id: imageId,
        purchaseId,
        relativePath,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes,
        width: meta.width,
        height: meta.height,
      });

      created.push({
        id: imageId,
        purchaseId,
        relativePath,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes,
        width: meta.width,
        height: meta.height,
        createdAt: new Date().toISOString(),
      });
    }

    return created;
  }

  async removeImage(imageId: string): Promise<PurchaseImageRecord | null> {
    const removed = await this.dbService.removeImageRecord(imageId);
    if (!removed) {
      return null;
    }

    const absolutePath = joinPath(this.dbService.getActiveMediaRoot(), removed.relativePath);
    try {
      await Filesystem.deleteFile({
        path: absolutePath,
        directory: Directory.Data,
      });
    } catch {
      // no-op: record is already removed from DB
    }

    return removed;
  }

  async readImageBase64(relativePath: string): Promise<string> {
    const absolutePath = joinPath(this.dbService.getActiveMediaRoot(), relativePath);
    const result = await Filesystem.readFile({
      path: absolutePath,
      directory: Directory.Data,
    });
    return String(result.data ?? '');
  }
}
