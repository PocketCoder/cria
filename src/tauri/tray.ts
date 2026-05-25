// Stub for Tauri tray API – minimal no‑op implementation
export class Tray {
  static async getCurrent(): Promise<Tray> {
    return new Tray();
  }
  async setIcon(_icon: string): Promise<void> {
    // No‑op – in production this updates the tray icon.
  }
  async setTooltip(_tooltip: string): Promise<void> {
    // No‑op – sets tooltip.
  }
}
