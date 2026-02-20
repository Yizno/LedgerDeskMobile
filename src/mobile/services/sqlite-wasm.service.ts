import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Directory, Filesystem, Encoding } from '@capacitor/filesystem';
import { base64ToBytes, bytesToBase64, normalizeBase64 } from '../lib/base64';

let sqlPromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: () => wasmUrl,
    });
  }
  return sqlPromise;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

function mapRow(stmt: any): Record<string, unknown> {
  const row = stmt.getAsObject() as Record<string, unknown>;
  return row;
}

export class SqliteWasmService {
  private db: Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async open() {
    const SQL = await loadSqlJs();
    if (await fileExists(this.dbPath)) {
      const file = await Filesystem.readFile({ path: this.dbPath, directory: Directory.Data });
      const base64 = normalizeBase64(String(file.data ?? ''));
      this.db = new SQL.Database(base64ToBytes(base64));
    } else {
      this.db = new SQL.Database();
    }

    this.exec('PRAGMA foreign_keys = ON;');
    this.exec('PRAGMA journal_mode = WAL;');
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  exec(sql: string) {
    if (!this.db) {
      throw new Error('Database is not open');
    }
    this.db.exec(sql);
  }

  run(sql: string, params: unknown[] = []) {
    if (!this.db) {
      throw new Error('Database is not open');
    }
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as any[]);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  all<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    if (!this.db) {
      throw new Error('Database is not open');
    }

    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as any[]);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(mapRow(stmt) as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): T | undefined {
    if (!this.db) {
      throw new Error('Database is not open');
    }
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as any[]);
      if (!stmt.step()) {
        return undefined;
      }
      return mapRow(stmt) as T;
    } finally {
      stmt.free();
    }
  }

  async persist() {
    if (!this.db) {
      throw new Error('Database is not open');
    }
    const bytes = this.db.export();
    await Filesystem.writeFile({
      path: this.dbPath,
      directory: Directory.Data,
      data: bytesToBase64(bytes),
    });
  }

  async replaceWithBinary(bytes: Uint8Array) {
    const SQL = await loadSqlJs();
    this.close();
    this.db = new SQL.Database(bytes);
    this.exec('PRAGMA foreign_keys = ON;');
    this.exec('PRAGMA journal_mode = WAL;');
    await this.persist();
  }

  exportBinary(): Uint8Array {
    if (!this.db) {
      throw new Error('Database is not open');
    }
    return this.db.export();
  }

  async vacuum() {
    this.exec('VACUUM;');
    await this.persist();
  }

  async writeSqlFile(path: string, sql: string) {
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: sql,
    });
  }
}
