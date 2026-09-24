import { SHORTCUTS } from '@/lib/shortcuts';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

function displayKey(key: string): string {
  return key
    .replace('mod+', IS_MAC ? '⌘' : 'Ctrl+')
    .replace('shift+', IS_MAC ? '⇧' : 'Shift+')
    .replace('alt+', IS_MAC ? '⌥' : 'Alt+')
    .replace('backspace', IS_MAC ? '⌫' : 'Del')
    .replace('enter', '↵')
    .replace('arrowleft', '←')
    .replace('arrowright', '→')
    .replace(/^([a-z])$/, (m) => m.toUpperCase());
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-[10px] text-[var(--color-muted-foreground)]">
              then
            </span>
          )}
          <kbd className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-muted-foreground)]">
            {displayKey(k)}
          </kbd>
        </span>
      ))}
    </span>
  );
}

/** Fixed shortcut set (mirrors upstream Vikunja — not rebindable). */
export function ShortcutsTab() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  const extras = [
    { label: 'Quick Add (system-wide)', keys: ['mod+shift+a'] },
    { label: 'Focus search', keys: ['mod+f'] },
    { label: 'Close panel / cancel', keys: ['esc'] },
  ];
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Shortcuts</h3>
      <div className="space-y-4">
        <div className="space-y-1 rounded-lg border border-[var(--color-border)] p-3">
          {extras.map((s) => (
            <div key={s.label} className="flex items-center justify-between py-1">
              <span className="text-sm">{s.label}</span>
              <Keys keys={s.keys} />
            </div>
          ))}
        </div>
        {groups.map((group) => (
          <div key={group}>
            <h4 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {group}
            </h4>
            <div className="space-y-1 rounded-lg border border-[var(--color-border)] p-3">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1">
                  <span className="text-sm">{s.label}</span>
                  <Keys keys={s.keys} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
