import { useEffect, useRef, type RefObject } from 'react';
import { updateNativeTabBar, type NativeTab, type NativeTabBarState } from '@/tauri/glass';

const HIDDEN: NativeTabBarState = {
  visible: false,
  dark: false,
  frame: { x: 0, y: 0, width: 0, height: 0 },
  tabs: [],
};

/**
 * Drive the iOS Liquid Glass tab bar from the (invisible) web one. The native
 * bar floats above the whole webview, so it must hide whenever anything web
 * covers the capsule (sheets, dialogs, overlays): we hit-test the capsule's
 * centre, which works because the web nav is transparent but still
 * hit-testable. Re-checked on any DOM/class/style change, coalesced per frame,
 * and only sent when the state actually changes.
 */
export function useNativeTabBar(
  enabled: boolean,
  navRef: RefObject<HTMLElement | null>,
  capsuleRef: RefObject<HTMLElement | null>,
  tabs: NativeTab[],
  onSelect: (key: string) => void,
): void {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const tabsKey = JSON.stringify(tabs);

  useEffect(() => {
    if (!enabled) return;
    const onTap = (e: Event) => onSelectRef.current(String((e as CustomEvent).detail));
    window.addEventListener('cria:native-tab', onTap);
    return () => window.removeEventListener('cria:native-tab', onTap);
  }, [enabled]);

  const recheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    let last = '';
    let frame = 0;
    const compute = () => {
      frame = 0;
      const cap = capsuleRef.current;
      if (!cap) return;
      const r = cap.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const state: NativeTabBarState = {
        visible: !!hit && !!navRef.current?.contains(hit),
        dark: document.documentElement.classList.contains('dark'),
        frame: { x: r.left, y: r.top, width: r.width, height: r.height },
        tabs: tabsRef.current,
      };
      const json = JSON.stringify(state);
      if (json === last) return;
      last = json;
      updateNativeTabBar(state);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(compute);
    };
    recheckRef.current = schedule;

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open'],
    });
    window.addEventListener('resize', schedule);
    // The keyboard resizes the visual viewport, not the layout one, so
    // `resize` doesn't fire; without this the bar stays where it was.
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
      recheckRef.current = () => {};
      updateNativeTabBar(HIDDEN);
    };
  }, [enabled, navRef, capsuleRef]);

  // New tabs/active/badge: resend.
  useEffect(() => {
    recheckRef.current();
  }, [tabsKey]);
}
