/**
 * On-device language model (Apple Foundation Models) via the Rust
 * `ai_generate` command → Swift bridge in src-tauri/swift/CriaAI.
 *
 * Plain text in, plain text out; callers own prompt design and parsing.
 * Rejects with `unsupportedOS`, `unavailable: <reason>` (no Apple
 * Intelligence / not enabled / model downloading), `cancelled` (user stopped
 * the iOS Live Activity) or a model error.
 *
 * Background behaviour: on iOS the native side runs the call as a continued
 * background task (system progress Live Activity) and posts the completion
 * notification itself, since this JS is suspended while the app is away. On
 * desktop the app keeps running, so we notify here when the window isn't
 * focused.
 */

import { invoke } from '@tauri-apps/api/core';
import { isMobilePlatform } from '@/lib/platform';
import { sendNotification } from './notification';

export interface GenerateArgs {
  /** User-facing label, e.g. "Organising your ramble". Shown in the Live Activity + notification. */
  title: string;
  instructions: string;
  prompt: string;
}

export async function generate(args: GenerateArgs): Promise<string> {
  try {
    const text = await invoke<string>('ai_generate', { ...args });
    notifyIfAway(args.title, 'Ready to review.');
    return text;
  } catch (e) {
    notifyIfAway(args.title, `Failed: ${String(e)}`);
    throw e;
  }
}

/**
 * `"available"`, or why the model can't run (`appleIntelligenceNotEnabled`,
 * `deviceNotEligible`, `modelNotReady`, `unsupportedOS`…). Never throws:
 * outside Tauri (Vite browser, tests) it reports `unsupportedOS`.
 */
export async function aiAvailability(): Promise<string> {
  try {
    return await invoke<string>('ai_availability');
  } catch {
    return 'unsupportedOS';
  }
}

function notifyIfAway(title: string, body: string): void {
  if (isMobilePlatform() || document.hasFocus()) return;
  void sendNotification({ title, body });
}
