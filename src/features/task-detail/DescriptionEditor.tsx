import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { sanitizeHtml } from '@/lib/sanitize';
import { onLinkClickOpenExternal } from '@/lib/openExternal';

interface DescriptionEditorProps {
  value: string | null;
  onSave: (next: string) => Promise<void>;
}

/**
 * Two-mode description surface: sanitised HTML render by default,
 * textarea edit on click. Vikunja stores task descriptions as HTML
 * (the web client uses TipTap). Editing as raw HTML is rudimentary;
 * M5 swaps this for a real TipTap WYSIWYG.
 *
 * Header strip holds the Edit / Save / Cancel controls so they don't
 * overlap the rendered description text.
 */
export function DescriptionEditor({ value, onSave }: DescriptionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing && taRef.current) taRef.current.focus();
  }, [editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(sanitizeHtml(draft));
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        {editing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(value ?? '');
                setEditing(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(4, Math.min(20, draft.split('\n').length + 1))}
          className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 font-mono text-xs leading-snug focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          placeholder="HTML or plain text. Sanitised on save."
        />
      ) : value ? (
        <div
          className="prose prose-sm max-w-none text-sm leading-relaxed [&_a]:cursor-pointer [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-2"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
          onClick={onLinkClickOpenExternal}
        />
      ) : (
        <p className="text-sm italic text-[var(--color-muted-foreground)]">
          No description.
        </p>
      )}
    </div>
  );
}
