import { Notice } from 'obsidian';

export class ProgressIndicator {
  private notice: Notice | null = null;
  private progressEl: HTMLElement | null = null;
  private progressBarEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private fileCount: number = 0;
  private processedCount: number = 0;

  constructor(totalFiles: number) {
    this.fileCount = totalFiles;
    this.initializeNotice();
  }

  private initializeNotice() {
    // Create a custom Notice element with progress bar
    this.notice = new Notice('', 0);
    
    // Get the notice content element
    const noticeContent = this.notice.noticeEl.querySelector('.notice-content');
    if (!noticeContent) return;
    
    // Add lorebook converter class for styling
    noticeContent.addClass('lorebook-converter-notice');
    
    // Create icon
    const iconEl = noticeContent.createDiv({ cls: 'lorebook-converter-notice-icon' });
    iconEl.innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="1s" repeatCount="indefinite"/></circle></svg>`;
    
    // Create content wrapper
    const contentWrapper = noticeContent.createDiv();
    
    // Create status text
    this.statusEl = contentWrapper.createDiv();
    this.updateStatus();
    
    // Create progress bar container
    this.progressEl = contentWrapper.createDiv({ cls: 'lorebook-converter-progress' });
    
    // Create progress bar
    this.progressBarEl = this.progressEl.createDiv({ cls: 'lorebook-converter-progress-bar' });
    this.progressBarEl.style.width = '0%';
  }

  updateProgress(increment: number = 1) {
    this.processedCount += increment;
    this.updateStatus();
    this.updateProgressBar();
  }

  private updateStatus() {
    if (!this.statusEl) return;
    
    // Set status text
    this.statusEl.setText(`Converting files (${this.processedCount}/${this.fileCount})`);
  }

  private updateProgressBar() {
    if (!this.progressBarEl) return;
    
    // Calculate percentage
    const percent = Math.min(100, Math.round((this.processedCount / this.fileCount) * 100));
    
    // Update progress bar width
    this.progressBarEl.style.width = `${percent}%`;
  }

  complete(message: string = 'Conversion complete!') {
    // Update to 100% first
    this.processedCount = this.fileCount;
    this.updateStatus();
    this.updateProgressBar();
    
    // Change icon to checkmark
    const iconEl = this.notice?.noticeEl.querySelector('.lorebook-converter-notice-icon');
    if (iconEl) {
      iconEl.innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="8" d="M20,50 L40,70 L80,30" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    
    // Update status text
    if (this.statusEl) {
      this.statusEl.setText(message);
    }
    
    // Close after delay
    setTimeout(() => {
      this.close();
    }, 3000);
  }

  error(message: string = 'Conversion failed!') {
    // Change icon to X
    const iconEl = this.notice?.noticeEl.querySelector('.lorebook-converter-notice-icon');
    if (iconEl) {
      iconEl.innerHTML = `<svg viewBox="0 0 100 100" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="8" d="M25,25 L75,75 M25,75 L75,25" stroke-linecap="round"/></svg>`;
    }
    
    // Update status text
    if (this.statusEl) {
      this.statusEl.setText(message);
    }
    
    // Close after delay
    setTimeout(() => {
      this.close();
    }, 3000);
  }

  close() {
    if (this.notice) {
      this.notice.hide();
      this.notice = null;
    }
  }
}
