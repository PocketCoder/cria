declare module '@tauri-apps/api/globalShortcut' {
  export function register(shortcut: string, handler: () => void): Promise<void>;
  export function unregister(shortcut: string): Promise<void>;
}
