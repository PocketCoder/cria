/**
 * Live speech-to-text via the webview's Web Speech API (WKWebView on
 * macOS/iOS). Wrapped here so callers never touch the vendor-prefixed global,
 * and so tests and the plain browser dev server can run without it.
 *
 * `onInterim` fires with the in-progress phrase as it is spoken; `onFinal`
 * fires once per finished phrase. Recognition restarts itself while wanted,
 * because the engine stops on its own after silence.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function speechSupported(): boolean {
  return ctor() !== undefined;
}

export interface SpeechHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  /** Recognition ended for good (stopped, or a fatal error such as denied permission). */
  onEnd: (error?: string) => void;
}

export interface SpeechSession {
  stop: () => void;
}

/** Start listening. Returns null when the webview has no speech engine. */
export function startSpeech(handlers: SpeechHandlers): SpeechSession | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-GB';

  let wanted = true;
  let fatal: string | undefined;

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      const t = r[0].transcript.trim();
      if (r.isFinal) {
        if (t) handlers.onFinal(t);
      } else {
        interim += `${t} `;
      }
    }
    handlers.onInterim(interim.trim());
  };
  rec.onerror = (e) => {
    // `no-speech` and `aborted` are routine; anything else (not-allowed,
    // service-not-allowed, audio-capture) will not fix itself on restart.
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      fatal = e.error;
      wanted = false;
    }
  };
  rec.onend = () => {
    handlers.onInterim('');
    if (wanted) {
      try {
        rec.start();
        return;
      } catch {
        // fall through to end
      }
    }
    handlers.onEnd(fatal);
  };

  try {
    rec.start();
  } catch (e) {
    handlers.onEnd(String(e));
    return { stop: () => {} };
  }
  return {
    stop: () => {
      wanted = false;
      try {
        rec.stop();
      } catch {
        handlers.onEnd();
      }
    },
  };
}

export function speechErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed')
    return 'Microphone or speech access was denied. Allow it in system settings and try again.';
  return `Speech recognition stopped (${code}).`;
}
