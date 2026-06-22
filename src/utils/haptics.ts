import { isMobilePlatform } from '@/lib/platform';

type HapticsModule = typeof import('@tauri-apps/plugin-haptics');

let mod: HapticsModule | null = null;

async function ensure(): Promise<HapticsModule | null> {
  if (!isMobilePlatform()) return null;
  if (!mod) {
    try {
      mod = await import('@tauri-apps/plugin-haptics');
    } catch {
      return null;
    }
  }
  return mod;
}

export async function impactComplete(): Promise<void> {
  const h = await ensure();
  if (!h) return;
  try {
    await h.impactFeedback('medium');
  } catch (e) { console.warn('[haptics] impactComplete failed:', e); }
}

export async function impactReordered(): Promise<void> {
  const h = await ensure();
  if (!h) return;
  try {
    await h.impactFeedback('light');
  } catch (e) { console.warn('[haptics] impactReordered failed:', e); }
}

export async function impactDeleted(): Promise<void> {
  const h = await ensure();
  if (!h) return;
  try {
    await h.notificationFeedback('warning');
  } catch (e) { console.warn('[haptics] impactDeleted failed:', e); }
}
