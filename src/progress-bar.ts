import { Notice } from 'obsidian';

export class ProgressBar {
  private notice: Notice;
  private progressEl: HTMLElement;
  private barEl: HTMLElement;
  private statusEl: HTMLElement;
  private total: number;
  private current: number = 0;
  private container: HTMLElement;
  
  constructor(total: number, initialMessage: string = 'Processing...') {
    this.total = total;
    
    // Create a long-lasting notice (0 means it stays until we hide it)
    this.notice = new Notice('', 0);
    
    // Find the notice element's content area or create a fallback
    // First try to find by class
    let contentEl = this.notice.noticeEl.querySelector('.notice-content');
    
    // If not found, look for any div inside
    if (!contentEl) {
      contentEl = this.notice.noticeEl.querySelector('div');
    }
    
    // If still not found, use the notice element itself as container
    if (!contentEl) {
      contentEl = this.notice.noticeEl;
    }
    
    // Store reference to container
    this.container = contentEl as HTMLElement;
    
    // Style the notice container - use addClass if available or fallback to classList
    if (typeof this.container.addClass === 'function') {
      this.container.addClass('lorebook-progress-container');
    } else {
      this.container.classList.add('lorebook-progress-container');
    }
    
    // Create status text element - handle both Obsidian's createDiv and standard DOM methods
    if (typeof this.container.createDiv === 'function') {
      this.statusEl = this.container.createDiv({ cls: 'lorebook-progress-status' });
    } else {
      this.statusEl = document.createElement('div');
      this.statusEl.className = 'lorebook-progress-status';
      this.container.appendChild(this.statusEl);
    }
    this.statusEl.textContent = initialMessage;
    
    // Create progress container
    let progressContainer: HTMLElement;
    if (typeof this.container.createDiv === 'function') {
      progressContainer = this.container.createDiv({ cls: 'lorebook-progress-outer' });
    } else {
      progressContainer = document.createElement('div');
      progressContainer.className = 'lorebook-progress-outer';
      this.container.appendChild(progressContainer);
    }
    
    // Create the actual progress bar
    if (typeof progressContainer.createDiv === 'function') {
      this.progressEl = progressContainer.createDiv({ cls: 'lorebook-progress-inner' });
    } else {
      this.progressEl = document.createElement('div');
      this.progressEl.className = 'lorebook-progress-inner';
      progressContainer.appendChild(this.progressEl);
    }
    this.progressEl.style.width = '0%';
    
    // Create text overlay for percentage
    if (typeof progressContainer.createDiv === 'function') {
      this.barEl = progressContainer.createDiv({ cls: 'lorebook-progress-text' });
    } else {
      this.barEl = document.createElement('div');
      this.barEl.className = 'lorebook-progress-text';
      progressContainer.appendChild(this.barEl);
    }
    this.barEl.textContent = '0%';
    
    // Update initial state
    this.update(0);
  }
  
  /**
   * Update the progress bar
   * @param increment Amount to increment by (default: 1)
   */
  update(increment: number = 1): void {
    this.current += increment;
    const percent = Math.min(100, Math.round((this.current / this.total) * 100));
    
    // Update progress bar width
    this.progressEl.style.width = `${percent}%`;
    
    // Update text
    this.barEl.textContent = `${percent}%`;
  }
  
  /**
   * Update the status message
   */
  setStatus(message: string): void {
    this.statusEl.textContent = message;
  }
  
  /**
   * Complete the progress bar with a success message
   */
  success(message: string = 'Complete!'): void {
    // Ensure 100%
    this.current = this.total;
    this.progressEl.style.width = '100%';
    this.barEl.textContent = '100%';
    
    // Add success class
    if (typeof this.progressEl.addClass === 'function') {
      this.progressEl.addClass('lorebook-progress-success');
    } else {
      this.progressEl.classList.add('lorebook-progress-success');
    }
    
    // Update message
    this.setStatus(message);
    
    // Close after delay
    setTimeout(() => {
      this.close();
    }, 3000);
  }
  
  /**
   * Show an error in the progress bar
   */
  error(message: string = 'Error!'): void {
    // Add error class
    if (typeof this.progressEl.addClass === 'function') {
      this.progressEl.addClass('lorebook-progress-error');
    } else {
      this.progressEl.classList.add('lorebook-progress-error');
    }
    
    // Update message
    this.setStatus(message);
    
    // Close after delay
    setTimeout(() => {
      this.close();
    }, 3000);
  }
  
  /**
   * Close the progress bar
   */
  close(): void {
    this.notice.hide();
  }
}