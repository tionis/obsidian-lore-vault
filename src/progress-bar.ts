import { Notice } from 'obsidian';

export class ProgressBar {
  private notice: Notice;
  private progressEl: HTMLElement;
  private barEl: HTMLElement;
  private statusEl: HTMLElement;
  private total: number;
  private current: number = 0;
  
  constructor(total: number, initialMessage: string = 'Processing...') {
    this.total = total;
    
    // Create a long-lasting notice
    this.notice = new Notice('', 0);
    
    // Get the content element of the notice
    const contentEl = this.notice.noticeEl.querySelector('.notice-content');
    if (!contentEl) {
      throw new Error('Could not find notice content element');
    }
    
    // Style the notice container
    contentEl.addClass('lorebook-progress-container');
    
    // Create status text element
    this.statusEl = contentEl.createDiv({ cls: 'lorebook-progress-status' });
    this.statusEl.textContent = initialMessage;
    
    // Create progress container
    const progressContainer = contentEl.createDiv({ cls: 'lorebook-progress-outer' });
    
    // Create the actual progress bar
    this.progressEl = progressContainer.createDiv({ cls: 'lorebook-progress-inner' });
    this.progressEl.style.width = '0%';
    
    // Create text overlay for percentage
    this.barEl = progressContainer.createDiv({ cls: 'lorebook-progress-text' });
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
    this.progressEl.addClass('lorebook-progress-success');
    
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
    this.progressEl.addClass('lorebook-progress-error');
    
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
