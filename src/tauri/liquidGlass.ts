/**
 * Native macOS Liquid Glass (tauri-plugin-liquid-glass).
 *
 * On macOS 26+ this backs the window with a real NSGlassEffectView; the plugin
 * falls back to NSVisualEffectView on older macOS and is a no-op on every other
 * platform. The effect is *window-level* — it tints the whole window background,
 * which the webview then sits on top of, so it's only visible where the webview
 * is transparent. Per Apple's HIG, Liquid Glass belongs to the navigation layer,
 * not the content layer: globals.css therefore reveals it behind the **sidebar
 * only** (the macOS vibrant-sidebar surface) and keeps the content, toolbar,
 * status bar and cards opaque — so the desktop never shows through your tasks.
 * The `.native-glass` class (added below once support is confirmed) gates all of
 * that; until then the body stays opaque, so a transparent window never reveals
 * the desktop on unsupported machines.
 *
 * Everything here is guarded: the plugin/API import, the platform check, and the
 * effect call. Any failure leaves the app in its plain (CSS-glass) state.
 */

/** True only inside a Tauri webview running on macOS. */
async function isMacOS(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    return platform() === 'macos';
  } catch {
    return false;
  }
}

/** Match the glass tint to the active colour scheme. */
function isDarkScheme(): boolean {
  const root = document.documentElement;
  if (root.classList.contains('dark')) return true;
  if (root.classList.contains('light')) return false;
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

let applied = false;

/**
 * Apply the native glass effect to the window if the platform supports it.
 * Safe to call on every platform and to call again after a theme change (it
 * re-tints). No-ops and resolves cleanly when unsupported.
 */
export async function applyNativeGlass(): Promise<void> {
  if (!(await isMacOS())) return;
  try {
    const { isGlassSupported, setLiquidGlassEffect, GlassMaterialVariant } =
      await import('tauri-plugin-liquid-glass-api');
    if (!(await isGlassSupported())) return;

    // Tint keyed to the theme so the glass reads as "Cria warm paper" / "Cria
    // deep violet" rather than raw desktop colour. Sidebar = the macOS
    // vibrant-sidebar material (this glass is only revealed behind the sidebar).
    const tintColor = isDarkScheme() ? '#1c1a2466' : '#fbfaf866';
    await setLiquidGlassEffect({
      variant: GlassMaterialVariant.Sidebar,
      tintColor,
    });

    document.documentElement.classList.add('native-glass');
    applied = true;
  } catch {
    // Plugin missing, private API blocked, or call failed — stay opaque.
  }
}

/** Re-tint the glass after a light/dark switch (no-op if never applied). */
export async function refreshNativeGlassTint(): Promise<void> {
  if (!applied) return;
  try {
    const { setLiquidGlassEffect, GlassMaterialVariant } = await import(
      'tauri-plugin-liquid-glass-api'
    );
    const tintColor = isDarkScheme() ? '#1c1a2466' : '#fbfaf866';
    await setLiquidGlassEffect({
      variant: GlassMaterialVariant.Sidebar,
      tintColor,
    });
  } catch {
    /* keep prior tint */
  }
}
