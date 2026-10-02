import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FullscreenService {
  readonly available = document.fullscreenEnabled;
  isFullscreen = !!document.fullscreenElement;

  constructor() {
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = !!document.fullscreenElement;
    });
  }

  async toggle(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // The browser may reject fullscreen if its permissions change.
    }
  }
}
