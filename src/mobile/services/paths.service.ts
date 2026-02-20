import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { nanoid } from 'nanoid';
import { dirname, joinPath } from '../lib/path';

export type SnapshotMeta = {
  id: string;
  label: string;
  createdAt: string;
  sourceZip: string | null;
  isActive: boolean;
};

type SnapshotFile = {
  snapshots: SnapshotMeta[];
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

async function exists(path: string) {
  try {
    await Filesystem.stat({
      path,
      directory: Directory.Data,
    });
    return true;
  } catch {
    return false;
  }
}

export class PathsService {
  readonly baseDir = 'BookkeepingApp';
  readonly dataDir = joinPath(this.baseDir, 'data');
  readonly exportsDir = joinPath(this.baseDir, 'exports');
  readonly tempDir = joinPath(this.baseDir, 'temp');
  readonly snapshotsMetaPath = joinPath(this.dataDir, 'snapshots.json');

  async ensureBaseLayout() {
    await ensureDir(this.dataDir);
    await ensureDir(this.exportsDir);
    await ensureDir(this.tempDir);

    if (!(await exists(this.snapshotsMetaPath))) {
      await this.writeSnapshotMeta({ snapshots: [] });
    }
  }

  async readSnapshotMeta(): Promise<SnapshotFile> {
    await this.ensureBaseLayout();
    try {
      const raw = await Filesystem.readFile({
        path: this.snapshotsMetaPath,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      const parsed = JSON.parse(String(raw.data ?? '{}')) as SnapshotFile;
      return {
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      };
    } catch {
      return { snapshots: [] };
    }
  }

  async writeSnapshotMeta(payload: SnapshotFile) {
    await ensureDir(dirname(this.snapshotsMetaPath));
    await Filesystem.writeFile({
      path: this.snapshotsMetaPath,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: JSON.stringify(payload, null, 2),
    });
  }

  async ensureActiveSnapshot(): Promise<SnapshotMeta> {
    const meta = await this.readSnapshotMeta();
    const active = meta.snapshots.find((item) => item.isActive);
    if (active) {
      await this.ensureDatasetLayout(active.id);
      return active;
    }

    const id = nanoid(12);
    const created: SnapshotMeta = {
      id,
      label: 'Default Dataset',
      createdAt: new Date().toISOString(),
      sourceZip: null,
      isActive: true,
    };

    await this.writeSnapshotMeta({ snapshots: [created] });
    await this.ensureDatasetLayout(id);
    return created;
  }

  async ensureDatasetLayout(datasetId: string) {
    await ensureDir(this.getDatasetDir(datasetId));
    await ensureDir(this.getMediaDir(datasetId));
  }

  getDatasetDir(datasetId: string) {
    return joinPath(this.dataDir, datasetId);
  }

  getDatabasePath(datasetId: string) {
    return joinPath(this.getDatasetDir(datasetId), 'bookkeeping.db');
  }

  getMediaDir(datasetId: string) {
    return joinPath(this.getDatasetDir(datasetId), 'media');
  }

  async getSnapshotList(): Promise<SnapshotMeta[]> {
    return (await this.readSnapshotMeta()).snapshots;
  }

  async activateSnapshot(snapshotId: string) {
    const meta = await this.readSnapshotMeta();
    let found = false;
    const snapshots = meta.snapshots.map((snapshot) => {
      if (snapshot.id === snapshotId) {
        found = true;
        return { ...snapshot, isActive: true };
      }
      return { ...snapshot, isActive: false };
    });

    if (!found) {
      throw new Error(`Snapshot ${snapshotId} does not exist.`);
    }

    await this.writeSnapshotMeta({ snapshots });
    await this.ensureDatasetLayout(snapshotId);
  }

  async addSnapshot(input: Omit<SnapshotMeta, 'isActive'>, setActive = false): Promise<SnapshotMeta> {
    const meta = await this.readSnapshotMeta();
    const snapshots = meta.snapshots.map((item) => ({
      ...item,
      isActive: setActive ? false : item.isActive,
    }));

    const snapshot: SnapshotMeta = {
      ...input,
      isActive: setActive,
    };

    snapshots.push(snapshot);
    await this.writeSnapshotMeta({ snapshots });
    await this.ensureDatasetLayout(snapshot.id);
    return snapshot;
  }
}
