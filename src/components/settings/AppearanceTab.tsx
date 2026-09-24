import { useSettings } from '@/stores/settings';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';

export function AppearanceTab() {
  const colorScheme = useSettings((s) => s.colorScheme);
  const setColorScheme = useSettings((s) => s.setColorScheme);
  const playSoundWhenDone = useSettings((s) => s.playSoundWhenDone);
  const setPlaySoundWhenDone = useSettings((s) => s.setPlaySoundWhenDone);

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Appearance</h3>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        <Label>Color Scheme</Label>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((scheme) => (
            <button
              key={scheme}
              onClick={() => setColorScheme(scheme)}
              className={cn(
                'flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-colors',
                colorScheme === scheme
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] hover:bg-[var(--color-muted)]',
              )}
            >
              {scheme === 'system' ? 'Auto' : scheme}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Label>Play sound when task is completed</Label>
          <Switch
            checked={playSoundWhenDone}
            onCheckedChange={setPlaySoundWhenDone}
          />
        </div>
      </div>
    </section>
  );
}
