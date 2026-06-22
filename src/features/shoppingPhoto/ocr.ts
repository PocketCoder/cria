import { parseShoppingItems } from './parseItems';

/**
 * OCR a photographed list and return cleaned, ready-to-create item strings.
 *
 * Two engines, tried in order:
 *  1. **Apple Vision** (native, on-device, free, private) via the Rust
 *     `recognize_text` command — the primary path on macOS and iOS, which are
 *     Cria's real targets. Works fully offline.
 *  2. **Tesseract.js** (WASM) — a cross-platform fallback for any environment
 *     where the native command isn't available (non-Apple desktop, the Vite
 *     dev browser). Lazily imported so it never weighs down the main bundle.
 *
 * The recognised lines from either engine go through the same
 * {@link parseShoppingItems} cleanup.
 */

export type OcrEngine = 'vision' | 'tesseract';

export interface OcrResult {
  items: string[];
  engine: OcrEngine;
}

/** File → base64 (no `data:` prefix), for handing image bytes to Rust. */
async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Apple Vision text recognition via the native command. Throws if unavailable. */
async function recognizeWithVision(file: Blob): Promise<string[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const imageBase64 = await fileToBase64(file);
  const lines = await invoke<string[]>('recognize_text', { imageBase64 });
  return lines ?? [];
}

/** Tesseract.js WASM fallback. */
async function recognizeWithTesseract(file: Blob): Promise<string[]> {
  const Tesseract = (await import('tesseract.js')).default;
  const { data } = await Tesseract.recognize(file, 'eng');
  return data.text.split(/\r?\n/);
}

/**
 * Run OCR on an image file and return parsed shopping items.
 * Surfaces a descriptive Error if no engine succeeds.
 */
export async function extractListItems(file: Blob): Promise<OcrResult> {
  let visionErr: unknown;
  try {
    const lines = await recognizeWithVision(file);
    return { items: parseShoppingItems(lines), engine: 'vision' };
  } catch (err) {
    visionErr = err;
  }

  try {
    const lines = await recognizeWithTesseract(file);
    return { items: parseShoppingItems(lines), engine: 'tesseract' };
  } catch (tessErr) {
    console.warn('[shopping-ocr] vision failed:', visionErr);
    console.warn('[shopping-ocr] tesseract failed:', tessErr);
    throw new Error(
      'Could not read the photo. Native text recognition is unavailable here and the fallback engine failed to load.',
    );
  }
}
