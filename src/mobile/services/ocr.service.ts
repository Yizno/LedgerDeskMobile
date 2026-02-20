import { createWorker, type Worker } from 'tesseract.js';
import { nanoid } from 'nanoid';
import type { OCRResult } from '@shared';
import { parseReceiptText } from '../lib/ocr-parsers';
import { DatabaseService } from './database.service';
import { MediaService } from './media.service';

export class OCRService {
  private workerPromise: Promise<Worker> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dbService: DatabaseService,
    private readonly mediaService: MediaService,
  ) {}

  private async getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = createWorker('eng', 1, {
        langPath: '/tessdata',
        gzip: false,
        logger: () => {
          // noop
        },
      });
    }
    return this.workerPromise;
  }

  async close() {
    if (this.workerPromise) {
      const worker = await this.workerPromise;
      await worker.terminate();
      this.workerPromise = null;
    }
  }

  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    this.queue = this.queue.then(async () => {
      result = await fn();
    });
    await this.queue;
    return result as T;
  }

  async extractByImageId(imageId: string): Promise<OCRResult> {
    const image = this.dbService.rawGet<any>('SELECT * FROM purchase_images WHERE id = ? LIMIT 1', [imageId]);
    if (!image) {
      throw new Error('Image not found');
    }
    const base64 = await this.mediaService.readImageBase64(String(image.relative_path));
    return this.enqueue(async () => this.extractFromBase64(imageId, base64, true));
  }

  async previewFromBase64(base64Data: string): Promise<OCRResult> {
    return this.enqueue(async () => this.extractFromBase64('preview', base64Data, false));
  }

  private async extractFromBase64(imageId: string, base64Data: string, persist: boolean): Promise<OCRResult> {
    const worker = await this.getWorker();
    const result = await worker.recognize(`data:image/jpeg;base64,${base64Data}`);
    const rawText = result.data.text ?? '';
    const parsed = parseReceiptText(rawText);

    const payload: OCRResult = {
      imageId,
      amountCandidateCents: parsed.amountCandidateCents,
      dateCandidate: parsed.dateCandidate,
      vendorCandidate: parsed.vendorCandidate,
      confidence: parsed.confidence,
      rawText,
    };

    if (persist) {
      await this.persistExtraction(payload);
    }

    return payload;
  }

  private async persistExtraction(result: OCRResult) {
    const now = new Date().toISOString();
    this.dbService.rawRun(
      `
      INSERT INTO ocr_extractions (
        id,
        purchase_image_id,
        raw_text,
        amount_candidate_cents,
        vendor_candidate,
        date_candidate,
        confidence_json,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)
      `,
      [
        nanoid(12),
        result.imageId,
        result.rawText,
        result.amountCandidateCents,
        result.vendorCandidate,
        result.dateCandidate,
        JSON.stringify(result.confidence),
        now,
      ],
    );
    await this.dbService.persistRaw();
  }
}
