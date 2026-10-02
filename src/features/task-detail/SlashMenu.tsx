import { cn } from '@/lib/cn';
import { filterCommands } from './editorCommands';

/** Floating slash-command popup, positioned above the caret in the lower half of the viewport. */
export function SlashMenu({
  query,
  coords,
  selectedIndex,
  onPick,
  onHover,
}: {
  query: string;
  coords: { top: number; left: number };
  selectedIndex: number;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
}) {
  const filteredCommands = filterCommands(query);
  if (filteredCommands.length === 0) return null;

  // Position slash menu dynamically to avoid running off viewport bottom
  const isLowerHalf = coords.top > window.innerHeight / 2;
  const popupTop = isLowerHalf ? coords.top - 248 : coords.top + 8;

  return (
    <div
      role="menu"
      className="fixed z-50 flex max-h-[220px] w-56 flex-col overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-lg ring-1 ring-black/5 focus:outline-none backdrop-blur-md"
      style={{
        top: `${popupTop}px`,
        left: `${coords.left}px`,
      }}
    >
      {filteredCommands.map((cmd, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={cmd.key}
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()} // Prevents stealing editor focus
            onClick={() => onPick(idx)}
            onMouseEnter={() => onHover(idx)}
            className={cn(
              'flex w-full items-center gap-3 rounded px-2.5 py-1.5 text-left transition-colors duration-75',
              isSelected
                ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]'
            )}
          >
            <span
              className={cn(
                'shrink-0',
                isSelected ? 'text-current' : 'text-[var(--color-muted-foreground)]'
              )}
            >
              {cmd.icon}
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium leading-none">{cmd.label}</span>
              <span
                className={cn(
                  'mt-0.5 text-micro leading-tight truncate',
                  isSelected
                    ? 'text-[var(--color-primary-foreground)]/80'
                    : 'text-[var(--color-muted-foreground)]'
                )}
              >
                {cmd.description}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
