/**
 * Live dictation via Apple's Speech framework (Rust `speech_*` commands →
 * Swift bridge in src-tauri/swift/CriaAI/Sources/CriaAI/Speech.swift).
 *
 * Speech is recognised on-device where the locale supports it. Native code
 * cuts a phrase after a pause: `onInterim` carries the phrase in progress,
 * `onFinal` fires once per finished phrase, and `onEnd` fires exactly once
 * when the session is over (stopped, or failed, with an error code).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface SpeechEvent {
  kind: 'interim' | 'final' | 'end';
  text?: string;
  error?: string;
}

export interface SpeechHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: (error?: string) => void;
}

export interface SpeechSession {
  stop: () => void;
}

/** Whether this build can dictate. False in the browser, tests and non-Apple-silicon builds. */
export async function speechAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>('speech_available');
  } catch {
    return false;
  }
}

/** Start listening. Rejects only if the event channel or command is unavailable. */
export async function startSpeech(handlers: SpeechHandlers): Promise<SpeechSession> {
  const unlisten = await listen<SpeechEvent>('speech', ({ payload: e }) => {
    if (e.kind === 'interim') handlers.onInterim(e.text ?? '');
    else if (e.kind === 'final') {
      if (e.text) handlers.onFinal(e.text);
    } else {
      unlisten();
      handlers.onEnd(e.error);
    }
  });
  try {
    await invoke('speech_start');
  } catch (err) {
    unlisten();
    throw err;
  }
  return { stop: () => void invoke('speech_stop').catch(() => {}) };
}

export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'speechDenied':
      return 'Speech recognition is switched off for Cria. Allow it in system settings and try again.';
    case 'microphoneDenied':
      return 'Microphone access is switched off for Cria. Allow it in system settings and try again.';
    case 'recogniserUnavailable':
      return "Speech recognition isn't available for your language right now.";
    default:
      return `Dictation stopped (${code}).`;
  }
}
