import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { FullscreenService } from '../fullscreen.service';

interface LibraryFolder {
  id: number;
  name: string;
  parentId?: number | null;
}

interface LibraryScore {
  id: number;
  title: string;
  composer: string;
  originalFilename: string;
  sizeBytes: number;
}

interface LibraryContents {
  folder: LibraryFolder;
  folders: LibraryFolder[];
  scores: LibraryScore[];
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit {
  currentFolderId = 1;
  currentFolderTitle = 'Library';
  parentFolderId: number | null = null;
  folders: LibraryFolder[] = [];
  scores: LibraryScore[] = [];
  loading = true;
  loadError = '';

  uploadOpen = false;
  uploading = false;
  uploadError = '';
  uploadTitle = '';
  uploadComposer = '';
  uploadFile: File | null = null;

  constructor(
    public fullscreen: FullscreenService,
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.currentFolderId = Number(params.get('folder')) || 1;
      void this.loadDocuments();
    });
  }

  ionViewWillEnter(): void {
    void this.loadDocuments();
  }

  async loadDocuments(): Promise<void> {
    const folderId = this.currentFolderId;
    this.loading = true;
    this.loadError = '';
    try {
      const data = await firstValueFrom(
        this.http.get<LibraryContents>('/api/library/folders/' + folderId)
      );
      if (folderId !== this.currentFolderId) return;
      this.currentFolderTitle = data.folder.name;
      this.parentFolderId = data.folder.parentId ?? null;
      this.folders = data.folders;
      this.scores = data.scores;
    } catch (error) {
      if (folderId === this.currentFolderId) {
        this.loadError = this.errorMessage(error);
        this.folders = [];
        this.scores = [];
      }
    } finally {
      if (folderId === this.currentFolderId) this.loading = false;
    }
  }

  goToParent(): void {
    this.router.navigateByUrl(
      this.parentFolderId && this.parentFolderId !== 1
        ? '/index/home/' + this.parentFolderId
        : '/index/home'
    );
  }

  openFolder(folder: LibraryFolder): void {
    this.router.navigateByUrl('/index/home/' + folder.id);
  }

  openScore(score: LibraryScore): void {
    const fileUrl = '/api/library/scores/' + score.id + '/file/' +
      encodeURIComponent(score.originalFilename);
    this.router.navigateByUrl('/play/' + encodeURIComponent(fileUrl));
  }

  async createFolder(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'New folder',
      inputs: [{ name: 'name', type: 'text', placeholder: 'Folder name' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Create', handler: (data) => { void this.saveFolder(data.name); } },
      ],
    });
    await alert.present();
  }

  private async saveFolder(name: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(
        '/api/library/folders/' + this.currentFolderId + '/folders', { name }
      ));
      await this.loadDocuments();
    } catch (error) {
      await this.showError(error);
    }
  }

  openUpload(): void {
    this.uploadTitle = '';
    this.uploadComposer = '';
    this.uploadFile = null;
    this.uploadError = '';
    this.uploadOpen = true;
  }

  selectUploadFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFile = input.files?.[0] ?? null;
    if (this.uploadFile && !this.uploadTitle.trim()) {
      this.uploadTitle = this.uploadFile.name.replace(/\.(xml|musicxml|mxl)$/i, '');
    }
  }

  async uploadScore(): Promise<void> {
    this.uploadError = '';
    if (!this.uploadTitle.trim() || !this.uploadComposer.trim() || !this.uploadFile) {
      this.uploadError = 'Enter a title, composer, and MusicXML file.';
      return;
    }
    const form = new FormData();
    form.append('title', this.uploadTitle.trim());
    form.append('composer', this.uploadComposer.trim());
    form.append('file', this.uploadFile);
    this.uploading = true;
    try {
      await firstValueFrom(this.http.post(
        '/api/library/folders/' + this.currentFolderId + '/scores', form
      ));
      this.uploadOpen = false;
      await this.loadDocuments();
    } catch (error) {
      this.uploadError = this.errorMessage(error);
    } finally {
      this.uploading = false;
    }
  }

  async renameFolder(folder: LibraryFolder): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Rename folder',
      inputs: [{ name: 'name', type: 'text', value: folder.name }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Save', handler: (data) => {
          void this.updateEntry('/api/library/folders/' + folder.id, { name: data.name });
        } },
      ],
    });
    await alert.present();
  }

  async editScore(score: LibraryScore): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Edit score',
      inputs: [
        { name: 'title', type: 'text', value: score.title, placeholder: 'Title' },
        { name: 'composer', type: 'text', value: score.composer, placeholder: 'Composer' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Save', handler: (data) => {
          void this.updateEntry('/api/library/scores/' + score.id, data);
        } },
      ],
    });
    await alert.present();
  }

  private async updateEntry(url: string, data: object): Promise<void> {
    try {
      await firstValueFrom(this.http.patch(url, data));
      await this.loadDocuments();
    } catch (error) {
      await this.showError(error);
    }
  }

  async deleteFolder(folder: LibraryFolder): Promise<void> {
    await this.confirmDelete(folder.name, '/api/library/folders/' + folder.id);
  }

  async deleteScore(score: LibraryScore): Promise<void> {
    await this.confirmDelete(score.title, '/api/library/scores/' + score.id);
  }

  private async confirmDelete(name: string, url: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete this item?',
      subHeader: name,
      message: 'Folders and their scores will be deleted permanently.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => {
          void this.removeEntry(url);
        } },
      ],
    });
    await alert.present();
  }

  private async removeEntry(url: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(url));
      await this.loadDocuments();
    } catch (error) {
      await this.showError(error);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return error.error?.error || 'Request failed (' + (error.status || 'offline') + ').';
    }
    return 'Something went wrong. Please try again.';
  }

  private async showError(error: unknown): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: this.errorMessage(error),
      color: 'danger',
      duration: 3500,
      position: 'bottom',
    });
    await toast.present();
  }

  fileSize(bytes: number): string {
    return bytes >= 1024 * 1024
      ? (bytes / (1024 * 1024)).toFixed(1) + ' MB'
      : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
}
