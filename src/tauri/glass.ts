/**
 * Native glass (see src-tauri/src/glass.rs).
 *
 * - `window` (macOS): a native material sits behind the transparent window;
 *   globals.css makes the page transparent only on the desktop shell's
 *   sidebar, and `syncNativeGlassTheme` keeps the material's light/dark in
 *   step with the in-app theme.
 * - `tabbar` (iOS 26+): a UIKit Liquid Glass tab bar floats over the webview;
 *   the web TabBar stays mounted (invisible) and streams its state to it via
 *   `updateNativeTabBar` (useNativeTabBar).
 * - `none`: everything stays web-rendered (browser, tests, older OSes).
 */

import { invoke } from '@tauri-apps/api/core';

export type NativeGlass = 'window' | 'tabbar' | 'none';

let kind: NativeGlass = 'none';

/** Resolve once at boot, before first render. Never rejects. */
export async function initNativeGlass(): Promise<void> {
  try {
    const k = await invoke<string>('native_glass');
    kind = k === 'window' || k === 'tabbar' ? k : 'none';
  } catch {
    kind = 'none';
  }
  if (kind !== 'none') document.documentElement.dataset.nativeGlass = kind;
}

export function nativeGlass(): NativeGlass {
  return kind;
}

/** macOS: match the native material to the app theme (null follows the OS). */
export function syncNativeGlassTheme(scheme: 'light' | 'dark' | 'system'): void {
  if (kind !== 'window') return;
  invoke('native_glass_theme', { theme: scheme === 'system' ? null : scheme }).catch(() => {});
}

export interface NativeTab {
  key: string;
  label: string;
  /** SF Symbol name. */
  symbol: string;
  active: boolean;
  badge?: string;
}

export interface NativeTabBarState {
  visible: boolean;
  dark: boolean;
  frame: { x: number; y: number; width: number; height: number };
  tabs: NativeTab[];
}

/** iOS: push the tab bar state to the native glass bar. */
export function updateNativeTabBar(state: NativeTabBarState): void {
  if (kind !== 'tabbar') return;
  invoke('glass_tabbar_update', { state: JSON.stringify(state) }).catch(() => {});
}
