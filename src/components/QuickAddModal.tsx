import { useEffect, useMemo, useRef, useState } from 'react';
import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';
import { addReminder, type AddReminderInput } from '@/db/reminders';
import { useUi } from '@/stores/ui';
import { useSelectableProjects } from '@/queries/projects';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { QuickAddPreview } from '@/features/tasks/QuickAddPreview';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import { X, ArrowUp, Camera } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PrioritySelect } from '@/components/ui/priority-select';
import { DatePicker } from '@/components/DatePicker';
import { LabelPicker } from '@/components/ui/label-picker';
import { RecurrencePicker } from '@/components/ui/recurrence-picker';
import { ReminderPill } from '@/components/ui/reminder-pill';
import type { TaskInput } from '@/domain/task';

export function QuickAddModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(0);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [labelTitles, setLabelTitles] = useState<string[]>([]);
  const [repeatAfter, setRepeatAfter] = useState<number | null>(null);
  const [repeatMode, setRepeatMode] = useState<number | null>(null);
  const [reminders, setReminders] = useState<AddReminderInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const activeView = useUi((s) => s.activeView);
  const setPhotoCaptureOpen = useUi((s) => s.setPhotoCaptureOpen);
  const selectedProjectId =
    activeView?.kind === 'project' ? activeView.localId : null;
  const { data: projects = [] } = useSelectableProjects();
  const [projectId, setProjectId] = useState<string | null>(
    selectedProjectId ?? null,
  );
  const isMobile = useIsMobile();

  // Focus the title without letting iOS scroll the page to it (that's what
  // dragged the background up when the sheet opened). `autoFocus` always
  // scroll-into-views; `focus({ preventScroll })` doesn't.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  // Freeze the background while the sheet is open so it stays static beneath
  // the overlay instead of scrolling/shifting.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ── Swipe-down-to-dismiss ────────────────────────────────────────────────
  // Same gesture as the Browse drawer, but the listeners only engage when the
  // touch *starts* in the top grab zone (the handle + Task-name row, ~84px
  // tall). Lower regions host the form inputs / popover chip row and would
  // fight typing or picker scrolls if drag hijacked them.
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startY: 0, active: false, allowed: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!isMobile) return;
    const panel = panelRef.current;
    if (!panel) return;

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const rect = panel.getBoundingClientRect();
      drag.current = {
        startY: t.clientY,
        active: false,
        allowed: t.clientY - rect.top < 84,
      };
    };
    const move = (e: TouchEvent) => {
      if (!drag.current.allowed) return;
      const dy = e.touches[0]!.clientY - drag.current.startY;
      if (!drag.current.active) {
        if (dy > 4) drag.current.active = true;
        else return;
      }
      if (dy <= 0) {
        setDragY(0);
        return;
      }
      e.preventDefault();
      setDragY(dy);
    };
    const end = (e: TouchEvent) => {
      if (!drag.current.active) return;
      const dy =
        (e.changedTouches[0]?.clientY ?? drag.current.startY) -
        drag.current.startY;
      drag.current.active = false;
      if (dy > 110) {
        setDragY(window.innerHeight);
        window.setTimeout(onClose, 240);
      } else {
        setDragY(0);
      }
    };

    panel.addEventListener('touchstart', start, { passive: true });
    panel.addEventListener('touchmove', move, { passive: false });
    panel.addEventListener('touchend', end, { passive: true });
    panel.addEventListener('touchcancel', end, { passive: true });
    return () => {
      panel.removeEventListener('touchstart', start);
      panel.removeEventListener('touchmove', move);
      panel.removeEventListener('touchend', end);
      panel.removeEventListener('touchcancel', end);
    };
  }, [isMobile, onClose]);

  // Lift the bottom sheet above the on-screen keyboard. iOS overlays the
  // keyboard without resizing the layout viewport, but visualViewport.height
  // shrinks — the difference is the keyboard inset. No-op where unsupported.
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardInset(inset > 24 ? inset : 0);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  useEffect(() => {
    if (!projectId && selectedProjectId) setProjectId(selectedProjectId);
  }, [selectedProjectId, projectId]);

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0]!.localId);
    }
  }, [projects, projectId]);

  // Resolve #project token — match case-insensitive against project titles
  const parsed = useMemo(() => parseQuickAdd(text), [text]);

  // Mirror a typed `!N` priority token into the button group, so NL and the
  // picker stay in sync. Only fires when the parsed token value changes, so a
  // manual button choice afterwards isn't clobbered on the next keystroke.
  useEffect(() => {
    if (parsed.priority !== null) setPriority(parsed.priority);
  }, [parsed.priority]);

  // Same NL-mirroring for a typed date ("tomorrow", "next fri") → date picker.
  useEffect(() => {
    if (parsed.dueDate) setDueDate(parsed.dueDate);
  }, [parsed.dueDate]);

  // Merge typed `*label` tokens into the label picker (union, so manual picks
  // aren't lost). Keyed on the joined titles so it only fires when they change.
  const parsedLabelsKey = parsed.labelTitles.join(' ');
  useEffect(() => {
    if (parsed.labelTitles.length === 0) return;
    setLabelTitles((prev) => {
      const lower = new Set(prev.map((t) => t.toLowerCase()));
      const merged = [...prev];
      for (const t of parsed.labelTitles) {
        if (!lower.has(t.toLowerCase())) merged.push(t);
      }
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedLabelsKey]);

  // Mirror a typed recurrence ("every 2 weeks", "monthly") into the picker.
  useEffect(() => {
    if (parsed.repeatAfter !== null || parsed.repeatMode !== null) {
      setRepeatAfter(parsed.repeatAfter);
      setRepeatMode(parsed.repeatMode);
    }
  }, [parsed.repeatAfter, parsed.repeatMode]);

  useEffect(() => {
    if (parsed.projectTitle && projects.length > 0) {
      const match = projects.find(
        (p) => p.title.toLowerCase() === parsed.projectTitle!.toLowerCase(),
      );
      if (match) setProjectId(match.localId);
    }
  }, [parsed.projectTitle, projects]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.title) return;
    // Need a project only when no +project token was typed (dropdown project).
    if (!parsed.projectTitle && !projectId) return;
    if (submitting) return;

    setSubmitting(true);
    try {
      // Resolve +project at submit time too — not only via the
      // dropdown-syncing effect — so a type-then-Enter race can't route
      // the task to the wrong (previously-selected) project.
      const matchedProject = parsed.projectTitle
        ? projects.find(
            (p) => p.title.toLowerCase() === parsed.projectTitle!.toLowerCase(),
          )
        : undefined;
        const input: TaskInput = {
          title: parsed.title,
          // If a +project token was parsed but no matching project exists,
          // omit the projectLocalId so the task falls back to the Inbox.
          ...(matchedProject ? { projectLocalId: matchedProject.localId } : {}),
          // If there is no +project token, keep the currently selected project.
          ...(!parsed.projectTitle ? { projectLocalId: projectId } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(dueDate ? { dueDate } : {}),
          ...(priority > 0 ? { priority } : {}),
          ...(repeatAfter !== null ? { repeatAfter } : {}),
          ...(repeatMode !== null ? { repeatMode } : {}),
        };
      const created = await createTask(input);

      // Apply chosen labels (picker + any typed *tokens) — create-if-missing.
      if (labelTitles.length > 0 && created.localId) {
        try {
          await applyLabelsByTitle(created.localId, labelTitles);
        } catch (err) {
          console.warn('[quick-add] label application failed:', err);
        }
      }

      // Persist create-time reminders (relative-to-due presets and/or an
      // absolute date+time). Relative reminders with no due date are parked
      // until one is set, matching the detail-view behaviour.
      if (reminders.length > 0 && created.localId) {
        for (const r of reminders) {
          try {
            await addReminder(created.localId, r);
          } catch (err) {
            console.warn('[quick-add] reminder add failed:', err);
          }
        }
      }

      // +assignee tokens are not yet applied (no local users table)
      if (parsed.assigneeUsernames.length > 0) {
        console.info(
          '[quick-add] +assignee tokens are parsed but not yet applied:',
          parsed.assigneeUsernames,
        );
      }

      onClose();
    } catch (err) {
      console.error('Quick add failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (isMobile) {
    // Todoist-style add-task sheet: a solid card anchored to the bottom (lifted
    // above the keyboard), with a large Task-name field, a Description line, a
    // horizontally-scrolling chip row of pickers, and a project selector +
    // round send button in the footer.
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col justify-end"
        role="dialog"
        aria-modal="true"
        aria-label="Add task"
        onClick={onClose}
      >
        <div className="sheet-backdrop absolute inset-0" />
        <div
          ref={panelRef}
          className={cn(
            'relative z-10 w-full rounded-t-2xl bg-[var(--color-card)] pt-2 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)]',
            dragY === 0 && !drag.current.active && 'animate-[sheet-up_300ms_var(--spring-snappy)]',
          )}
          style={{
            marginBottom: keyboardInset,
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: drag.current.active ? 'none' : 'transform 240ms var(--spring-snappy)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-[var(--color-muted-foreground)]/30" />
          <form onSubmit={handleSubmit}>
            <div className="px-5 pt-3">
              <input
                ref={titleRef}
                type="text"
                placeholder="Task name"
                className="w-full bg-transparent text-xl font-semibold placeholder-[var(--color-muted-foreground)] focus:outline-none"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <input
                type="text"
                placeholder="Description"
                className="mt-2 w-full bg-transparent text-sm text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <QuickAddPreview parsed={parsed} />
            </div>

            {/* Chip row — due date (smart), labels, priority, reminder,
                repeat. Project lives in the footer (Todoist-style). All
                compact pills; each expands into a popover. Scrollable. */}
            <div className="mt-5 flex items-center gap-2 overflow-x-auto px-5 pb-4 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
              <DatePicker value={dueDate} onChange={setDueDate} placeholder="Date" enableTime smart />
              <LabelPicker value={labelTitles} onChange={setLabelTitles} />
              <PrioritySelect value={priority} onChange={setPriority} variant="pill" />
              <ReminderPill value={reminders} onChange={setReminders} />
              <RecurrencePicker
                repeatAfter={repeatAfter}
                repeatMode={repeatMode}
                onChange={(after, mode) => {
                  setRepeatAfter(after);
                  setRepeatMode(mode);
                }}
              />
            </div>

            {/* Footer — project selector (left, Todoist-style borderless) +
                camera & send grouped on the right. */}
            <div
              className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-3"
              style={{ paddingBottom: keyboardInset ? undefined : 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
            >
              {projects.length > 0 ? (
                <Select value={projectId ?? ''} onValueChange={(v) => setProjectId(v || null)}>
                  <SelectTrigger className="inline-flex h-auto w-auto min-w-0 max-w-[55%] justify-start gap-1.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] [&>span]:truncate" aria-label="Project">
                    <SelectValue placeholder="Inbox" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.localId} value={p.localId}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                            style={p.hexColor ? { backgroundColor: p.hexColor } : undefined}
                          />
                          <span className="truncate">{p.title}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : <span />}
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Add tasks from a photo"
                  title="Add tasks from a photo of a list"
                  onClick={() => {
                    onClose();
                    setPhotoCaptureOpen(true);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                >
                  <Camera className="h-5 w-5" />
                </button>
                <button
                  type="submit"
                  disabled={submitting || !parsed.title || (!parsed.projectTitle && !projectId)}
                  aria-label="Add task"
                  className="fab flex h-11 w-11 items-center justify-center disabled:opacity-40 disabled:shadow-none"
                >
                  <ArrowUp className="h-6 w-6" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24"
      onClick={onClose}
    >
      {!isMobile && (
        <div
          className="glass-surface w-11/12 max-w-lg rounded-lg p-4 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Quick Add</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-2">
            <input
              ref={titleRef}
              type="text"
              placeholder="Buy milk tomorrow *groceries !2 @alice +Personal"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <QuickAddPreview parsed={parsed} />
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker value={dueDate} onChange={setDueDate} placeholder="Due date" enableTime />
              <LabelPicker value={labelTitles} onChange={setLabelTitles} />
              <PrioritySelect value={priority} onChange={setPriority} variant="pill" />
              <ReminderPill value={reminders} onChange={setReminders} />
              <RecurrencePicker
                repeatAfter={repeatAfter}
                repeatMode={repeatMode}
                onChange={(after, mode) => {
                  setRepeatAfter(after);
                  setRepeatMode(mode);
                }}
              />
            </div>
              <div className="flex items-center justify-between gap-2">
                {projects.length > 0 ? (
                  <Select value={projectId ?? ''} onValueChange={(v) => setProjectId(v || null)}>
                    <SelectTrigger className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs" aria-label="Project">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
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
                ) : null}
              <div className="flex items-center gap-2 text-caption text-[var(--color-muted-foreground)]">
                <span>Enter to add · Esc to cancel</span>
                <button
                  type="submit"
                  disabled={submitting || !parsed.title || (!parsed.projectTitle && !projectId)}
                  className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
