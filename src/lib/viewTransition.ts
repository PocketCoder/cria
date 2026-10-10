import { flushSync } from 'react-dom';
import { isMobilePlatform } from '@/lib/platform';

/**
 * Which animation the CSS in globals.css plays (via `html[data-vt=…]`):
 * - `nav`: switching to a different view or project (title + pane rise in).
 * - `view`: switching List/Kanban/Table/Gantt within a project (fade only).
 * - `task`: opening, closing or switching the desktop inspector.
 * - `theme`: circular reveal from the pointer (`--vt-x`/`--vt-y`).
 */
export type TransitionKind = 'nav' | 'view' | 'task' | 'theme';

interface Options {
  /** Runs after the DOM update, before the new snapshot is taken. */
  afterUpdate?: () => void;
  /** Hold the new snapshot until this selector matches (async query data). */
  waitFor?: string;
}

const root = () => document.documentElement;

// Identifies the transition that currently owns `html[data-vt]`. Plain module
// state is enough (unlike the cross-tick queues in AGENTS.md): it only spans
// one animation, and an HMR reset mid-flight costs at most one stray marker.
let currentTransition = 0;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function canAnimate(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function' &&
    // WKWebView drops position:fixed layers (the tab bar) after a view
    // transition until the next scroll repaints them, so skip on iOS.
    !isMobilePlatform() &&
    // The global reduce-motion rule in globals.css doesn't reach the
    // ::view-transition-* pseudo-elements, so honour it here.
    !prefersReducedMotion()
  );
}

// ponytail: polls for ~10 frames, then snapshots whatever rendered. Long
// enough for a local-DB query, short enough that input isn't held noticeably.
async function waitForSelector(selector: string) {
  for (let i = 0; i < 10 && !document.querySelector(selector); i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
}

/**
 * Run a state update inside a same-document View Transition. React 18 has no
 * <ViewTransition>, so flushSync commits the update synchronously inside the
 * browser's update callback. Falls back to a plain update where unsupported
 * (older WKWebView) or when the user prefers reduced motion. Resolves once
 * the animation has finished (or straight away on the fallback path).
 */
export function withViewTransition(
  kind: TransitionKind,
  update: () => void,
  { afterUpdate, waitFor }: Options = {},
): Promise<void> {
  if (!canAnimate()) {
    update();
    afterUpdate?.();
    return Promise.resolve();
  }
  // A running transition is skipped by the new one; overwriting the marker
  // here, and the token check in `finally`, keep the newest transition's CSS
  // in charge (comparing kinds isn't enough: two of the same kind overlap).
  const id = ++currentTransition;
  root().dataset.vt = kind;
  const vt = document.startViewTransition(async () => {
    flushSync(update);
    if (waitFor) await waitForSelector(waitFor);
    afterUpdate?.();
  });
  return vt.finished
    .catch(() => {}) // only rejects if `update` threw; React already surfaced it
    .finally(() => {
      if (currentTransition === id) delete root().dataset.vt;
    });
}
