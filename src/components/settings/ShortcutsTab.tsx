export function ShortcutsTab() {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Shortcuts</h3>
      <div className="space-y-1 rounded-lg border border-[var(--color-border)] p-3">
        {[
          { label: 'Quick Add', keys: '⌘+Shift+A' },
          { label: 'Search', keys: '⌘+F' },
          { label: 'Close panel / Cancel', keys: 'Esc' },
        ].map((shortcut) => (
          <div key={shortcut.label} className="flex items-center justify-between py-1">
            <span className="text-sm text-[var(--color-foreground)]">{shortcut.label}</span>
            <span className="rounded bg-[var(--color-muted)] px-2 py-0.5 text-xs font-mono text-[var(--color-muted-foreground)]">
              {shortcut.keys}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
