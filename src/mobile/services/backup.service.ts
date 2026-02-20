import { Directory, Filesystem } from '@capacitor/filesystem';
import JSZip from 'jszip';
import { nanoid } from 'nanoid';
import type { ExportCustomCsvRequest, ExportRequest, ImportRequest, ImportValidationResult, SnapshotRecord } from '@shared';
import { importValidationResultSchema } from '@shared';
import { DatabaseService } from './database.service';
import { PathsService } from './paths.service';
import { dirname, isUnsafeRelativePath, joinPath } from '../lib/path';
import { base64ToBytes, bytesToBase64, normalizeBase64 } from '../lib/base64';

type Manifest = {
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  datasetId: string;
};

const EXPORT_TABLES = [
  'categories',
  'tags',
  'purchases',
  'purchase_images',
  'purchase_tags',
  'monthly_budgets',
  'ocr_extractions',
  'app_settings',
  'dataset_snapshots',
] as const;

const IMPORT_TABLES = EXPORT_TABLES;
const CSV_TABLES = EXPORT_TABLES;

function toCsvCell(value: string) {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0]!);
  const headerRow = headers.map(toCsvCell).join(',');
  const body = rows.map((row) =>
    headers.map((key) => toCsvCell(String(row[key] ?? ''))).join(','),
  );
  return [headerRow, ...body].join('\r\n');
}

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', stable);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

export class BackupService {
  private readonly pickedFiles = new Map<string, File>();

  constructor(
    private readonly dbService: DatabaseService,
    private readonly paths: PathsService,
  ) {}

  private async listAllPurchases() {
    const pageSize = 500;
    let offset = 0;
    const items: any[] = [];

    while (true) {
      const page = this.dbService.listPurchases({ limit: pageSize, offset });
      items.push(...page.items);
      offset += pageSize;

      if (items.length >= page.total || page.items.length < pageSize) {
        break;
      }
    }

    return items;
  }

  private async readZipBytes(zipPath: string): Promise<Uint8Array> {
    if (zipPath.startsWith('picked://')) {
      const file = this.pickedFiles.get(zipPath);
      if (!file) {
        throw new Error('Selected ZIP token no longer exists.');
      }
      return new Uint8Array(await file.arrayBuffer());
    }

    const raw = await Filesystem.readFile({
      path: zipPath,
      directory: Directory.Data,
    });
    return base64ToBytes(normalizeBase64(String(raw.data ?? '')));
  }

  async exportZip(request: ExportRequest = {}): Promise<{ outputPath: string }> {
    const destination =
      request.destinationPath ??
      joinPath(this.paths.exportsDir, `bookkeeping-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);

    await ensureDir(dirname(destination));

    const manifest: Manifest = {
      schemaVersion: 1,
      appVersion: '1.0.0',
      createdAt: new Date().toISOString(),
      datasetId: this.dbService.getActiveDatasetId(),
    };

    const zip = new JSZip();
    const checksums: Record<string, string> = {};

    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    zip.file('manifest.json', manifestBytes);
    checksums['manifest.json'] = await sha256Hex(manifestBytes);

    for (const table of EXPORT_TABLES) {
      const rows = this.dbService.rawAll(`SELECT * FROM ${table}`);
      const jsonBytes = new TextEncoder().encode(JSON.stringify(rows, null, 2));
      const jsonPath = `json/${table}.json`;
      zip.file(jsonPath, jsonBytes);
      checksums[jsonPath] = await sha256Hex(jsonBytes);
    }

    for (const table of CSV_TABLES) {
      const rows = this.dbService.rawAll(`SELECT * FROM ${table}`);
      const csvBytes = new TextEncoder().encode(toCsv(rows as Array<Record<string, unknown>>));
      const csvPath = `csv/${table}.csv`;
      zip.file(csvPath, csvBytes);
      checksums[csvPath] = await sha256Hex(csvBytes);
    }

    const mediaRows = this.dbService.rawAll<any>(
      'SELECT relative_path FROM purchase_images ORDER BY created_at ASC',
    );
    for (const row of mediaRows) {
      const relativePath = String(row.relative_path);
      const absolutePath = joinPath(this.dbService.getActiveMediaRoot(), relativePath);
      const mediaFile = await Filesystem.readFile({
        path: absolutePath,
        directory: Directory.Data,
      });
      const mediaBase64 = normalizeBase64(String(mediaFile.data ?? ''));
      const mediaBytes = base64ToBytes(mediaBase64);
      const zipPath = `media/${relativePath.replace(/\\/g, '/')}`;
      zip.file(zipPath, mediaBytes);
      checksums[zipPath] = await sha256Hex(mediaBytes);
    }

    const checksumsBytes = new TextEncoder().encode(JSON.stringify(checksums, null, 2));
    zip.file('checksums.json', checksumsBytes);

    const base64Zip = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
    await Filesystem.writeFile({
      path: destination,
      directory: Directory.Data,
      data: base64Zip,
    });

    return { outputPath: destination };
  }

  async exportCustomCsv(request: ExportCustomCsvRequest): Promise<{ outputPath: string; rowCount: number; columns: string[] }> {
    const selectedColumns = [
      request.includeDate ? 'Date' : null,
      request.includeVendor ? 'Vendor' : null,
      request.includeAmount ? 'Amount' : null,
      request.includeCategory ? 'Category' : null,
    ].filter((value): value is string => Boolean(value));

    if (selectedColumns.length === 0) {
      throw new Error('Select at least one CSV column before exporting.');
    }

    const destination =
      request.destinationPath ??
      joinPath(this.paths.exportsDir, `bookkeeping-custom-export-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);

    await ensureDir(dirname(destination));

    const purchases = await this.listAllPurchases();
    const categoriesById = new Map(this.dbService.listCategories().map((category) => [category.id, category.name]));

    const headerRow = selectedColumns.map(toCsvCell).join(',');
    const dataRows = purchases.map((purchase) => {
      const cells: string[] = [];
      if (request.includeDate) {
        cells.push(toCsvCell(purchase.purchaseDate));
      }
      if (request.includeVendor) {
        cells.push(toCsvCell(purchase.vendor ?? ''));
      }
      if (request.includeAmount) {
        cells.push(toCsvCell((purchase.amountCents / 100).toFixed(2)));
      }
      if (request.includeCategory) {
        const categoryLabel = purchase.categoryId
          ? (categoriesById.get(purchase.categoryId) ?? 'Unknown')
          : 'Uncategorized';
        cells.push(toCsvCell(categoryLabel));
      }
      return cells.join(',');
    });

    const csvContent = `\uFEFF${[headerRow, ...dataRows].join('\r\n')}`;
    await Filesystem.writeFile({
      path: destination,
      directory: Directory.Data,
      data: csvContent,
    });

    return {
      outputPath: destination,
      rowCount: purchases.length,
      columns: selectedColumns,
    };
  }

  async pickImportZip(): Promise<{ canceled: boolean; zipPath?: string }> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';

    return new Promise((resolve) => {
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ canceled: true });
          return;
        }
        const token = `picked://${nanoid(10)}`;
        this.pickedFiles.set(token, file);
        resolve({ canceled: false, zipPath: token });
      };
      input.oncancel = () => resolve({ canceled: true });
      input.click();
    });
  }

  async validateZip(zipPath: string): Promise<ImportValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let manifest: Manifest | null = null;

    let bytes: Uint8Array;
    try {
      bytes = await this.readZipBytes(zipPath);
    } catch {
      return {
        valid: false,
        errors: ['ZIP file does not exist or cannot be read.'],
        warnings,
        manifest,
      };
    }

    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.keys(zip.files);

    if (entries.some((entry) => isUnsafeRelativePath(entry))) {
      errors.push('ZIP contains invalid paths.');
    }

    if (!entries.includes('manifest.json')) {
      errors.push('Missing manifest.json');
    }

    if (!entries.includes('checksums.json')) {
      warnings.push('Missing checksums.json; integrity validation limited.');
    }

    if (errors.length === 0) {
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        errors.push('Missing manifest.json');
      } else {
        const raw = await manifestFile.async('string');
        try {
          manifest = JSON.parse(raw) as Manifest;
          if (manifest.schemaVersion !== 1) {
            errors.push(`Unsupported schema version ${manifest.schemaVersion}.`);
          }
        } catch {
          errors.push('manifest.json is not valid JSON.');
        }
      }
    }

    if (entries.includes('checksums.json')) {
      const checksumsFile = zip.file('checksums.json');
      if (checksumsFile) {
        const expected = JSON.parse(await checksumsFile.async('string')) as Record<string, string>;
        for (const [filePath, expectedHash] of Object.entries(expected)) {
          const entry = zip.file(filePath);
          if (!entry) {
            errors.push(`Missing expected file ${filePath}.`);
            continue;
          }
          const actualHash = await sha256Hex(new Uint8Array(await entry.async('uint8array')));
          if (actualHash !== expectedHash) {
            errors.push(`Checksum mismatch for ${filePath}.`);
          }
        }
      }
    }

    return importValidationResultSchema.parse({
      valid: errors.length === 0,
      errors,
      warnings,
      manifest,
    });
  }

  async importZip(request: ImportRequest): Promise<{ snapshot: SnapshotRecord }> {
    const validation = await this.validateZip(request.zipPath);
    if (!validation.valid) {
      throw new Error(`Import validation failed: ${validation.errors.join('; ')}`);
    }

    const zipBytes = await this.readZipBytes(request.zipPath);
    const zip = await JSZip.loadAsync(zipBytes);

    const snapshot = await this.dbService.addSnapshot(
      request.label ?? `Imported ${new Date().toLocaleString()}`,
      request.zipPath,
      false,
    );

    await this.dbService.switchSnapshot(snapshot.id);

    for (const table of IMPORT_TABLES) {
      const file = zip.file(`json/${table}.json`);
      if (!file) {
        continue;
      }
      const rows = JSON.parse(await file.async('string')) as Array<Record<string, unknown>>;
      this.dbService.rawRun(`DELETE FROM ${table}`);
      if (rows.length === 0) {
        continue;
      }
      const keys = Object.keys(rows[0]!);
      const placeholders = keys.map(() => '?').join(',');
      const insertSql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
      for (const row of rows) {
        this.dbService.rawRun(insertSql, keys.map((key) => row[key]));
      }
    }

    for (const entryName of Object.keys(zip.files)) {
      if (!entryName.startsWith('media/') || entryName.endsWith('/')) {
        continue;
      }
      const relativeMediaPath = entryName.slice('media/'.length);
      if (!relativeMediaPath || isUnsafeRelativePath(relativeMediaPath)) {
        continue;
      }

      const mediaFile = zip.file(entryName);
      if (!mediaFile) {
        continue;
      }
      const bytes = new Uint8Array(await mediaFile.async('uint8array'));
      const destination = joinPath(this.dbService.getActiveMediaRoot(), relativeMediaPath);
      await ensureDir(dirname(destination));
      await Filesystem.writeFile({
        path: destination,
        directory: Directory.Data,
        data: bytesToBase64(bytes),
      });
    }

    await this.dbService.persistRaw();
    return { snapshot: { ...snapshot, isActive: true } };
  }
}
