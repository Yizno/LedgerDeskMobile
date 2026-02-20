import { BackupService } from './backup.service';
import { DatabaseService } from './database.service';
import { MediaService } from './media.service';
import { OCRService } from './ocr.service';
import { PathsService } from './paths.service';

export class AppServices {
  readonly paths: PathsService;
  readonly db: DatabaseService;
  readonly media: MediaService;
  readonly ocr: OCRService;
  readonly backup: BackupService;

  private constructor(
    paths: PathsService,
    db: DatabaseService,
    media: MediaService,
    ocr: OCRService,
    backup: BackupService,
  ) {
    this.paths = paths;
    this.db = db;
    this.media = media;
    this.ocr = ocr;
    this.backup = backup;
  }

  static async create() {
    const paths = new PathsService();
    await paths.ensureBaseLayout();
    const db = await DatabaseService.create(paths);
    const media = new MediaService(db);
    const ocr = new OCRService(db, media);
    const backup = new BackupService(db, paths);
    return new AppServices(paths, db, media, ocr, backup);
  }

  async close() {
    await this.ocr.close();
    this.db.close();
  }
}
