import { useSettings } from '@/stores/settings';

/**
 * Plays a short two-note chime when a task is completed — but only if the
 * user enabled "Play sound when task is completed" in settings.
 *
 * Self-contained: synthesises the blip with the Web Audio API so there's no
 * audio asset to bundle. Lazily creates a single shared AudioContext (the
 * first call may be a no-op on browsers that gate audio behind a user
 * gesture, but task completion *is* a user gesture, so it works in practice).
 * Any failure (Web Audio unavailable, context blocked) is swallowed — a
 * missing chime must never break completing a task.
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

export function playCompletionSound(): void {
  if (!useSettings.getState().playSoundWhenDone) return;
  try {
    const audio = getContext();
    if (!audio) return;
    const now = audio.currentTime;
    // Ascending A5 → E6, ~90ms apart — a quick, unobtrusive "ding".
    [880, 1318.51].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    });
  } catch {
    // Web Audio unavailable or blocked — skip silently.
  }
}
