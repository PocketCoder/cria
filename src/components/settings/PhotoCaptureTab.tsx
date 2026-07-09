import { useSettings } from '@/stores/settings';
import { useProjects } from '@/queries/projects';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function PhotoCaptureTab() {
  const shoppingProjectId = useSettings((s) => s.shoppingProjectId);
  const setShoppingProjectId = useSettings((s) => s.setShoppingProjectId);
  const shoppingLabel = useSettings((s) => s.shoppingLabel);
  const setShoppingLabel = useSettings((s) => s.setShoppingLabel);
  const { data: projects = [] } = useProjects();

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Photo capture</h3>
      <p className="mb-3 text-caption text-[var(--color-muted-foreground)]">
        Defaults for creating tasks from a photo of a list. You can still
        change the project and label each time you import.
      </p>
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        <div className="flex items-center justify-between">
          <Label>Default project</Label>
          <Select
            value={shoppingProjectId ?? '__ask__'}
            onValueChange={(v) => setShoppingProjectId(v === '__ask__' ? null : v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Ask each time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ask__">Ask each time</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.localId} value={p.localId}>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                      style={p.hexColor ? { backgroundColor: p.hexColor } : undefined}
                    />
                    {p.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label>Default label</Label>
          <input
            type="text"
            value={shoppingLabel}
            onChange={(e) => setShoppingLabel(e.target.value)}
            placeholder="e.g. shopping (blank for none)"
            className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
          />
        </div>
      </div>
    </section>
  );
}
