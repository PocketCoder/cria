import { useEffect, useMemo, useRef, useState } from 'react';
import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';
import { addReminder, type AddReminderInput } from '@/db/reminders';
import { useUi } from '@/stores/ui';
import { useSelectableProjects } from '@/queries/projects';
import { useCurrentUser } from '@/queries/user';
import { parseQuickAdd, type QuickAddResult } from '@/lib/quickAddParser';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import { ArrowUp, Camera, CalendarDays, Tag, Bell } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PrioritySelect, priorityColor } from '@/components/ui/priority-select';
import { DatePicker } from '@/components/DatePicker';
import { LabelPicker } from '@/components/ui/label-picker';
import { RecurrencePicker } from '@/components/ui/recurrence-picker';
import { ReminderPill } from '@/components/ui/reminder-pill';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { formatDue } from '@/features/tasks/TaskRowCore';
import type { TaskInput } from '@/domain/task';
import type { Project } from '@/domain/project';

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function repeatLabel(repeatAfter: number | null, repeatMode: number | null): string {
  if (repeatMode === 1) return 'Monthly';
  if (repeatAfter === null) return '';
  const HOUR = 3600;
  const DAY = 86400;
  const WEEK = 604800;
  const YEAR = 31536000;
  if (repeatAfter % YEAR === 0 && repeatAfter >= YEAR) {
    const n = repeatAfter / YEAR;
    return n === 1 ? 'Yearly' : `Every ${n} years`;
  }
  if (repeatAfter % WEEK === 0 && repeatAfter >= WEEK) {
    const n = repeatAfter / WEEK;
    return n === 1 ? 'Weekly' : `Every ${n} weeks`;
  }
  if (repeatAfter % DAY === 0 && repeatAfter >= DAY) {
    const n = repeatAfter / DAY;
    return n === 1 ? 'Daily' : `Every ${n} days`;
  }
  if (repeatAfter % HOUR === 0 && repeatAfter >= HOUR) {
    const n = repeatAfter / HOUR;
    return n === 1 ? 'Hourly' : `Every ${n} hours`;
  }
  return `Every ${repeatAfter}s`;
}

/**
 * The Task-name field with parsed quick-add tokens highlighted inline.
 * A transparent-text input sits on top of an aria-hidden mirror that paints
 * the tokens (`--color-primary` on a light blue, 5px radius); the two share
 * the wrapper's font metrics so they stay pixel-aligned. Scroll syncs so a
 * long title doesn't desync the mirror.
 */
function TokenInput({
  value,
  parsed,
  onChange,
  onKeyDown,
  inputRef,
  placeholder,
  className,
}: {
  value: string;
  parsed: QuickAddResult;
  onChange: (v: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  placeholder?: string;
  className?: string;
}) {
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const syncScroll = (el: HTMLInputElement | null) => {
    if (mirrorRef.current && el) {
      mirrorRef.current.scrollLeft = el.scrollLeft;
    }
  };
  return (
    <div className={cn('relative w-full', className)}>
      <span
        ref={mirrorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-nowrap"
      >
        {parsed.tokens.map((t, i) =>
          t.kind === 'text' ? (
            <span key={i} className="text-[var(--color-foreground)]">
              {t.text}
            </span>
          ) : (
            <span
              key={i}
              className="rounded-[5px] bg-[oklch(95% 0.02 255)] px-0.5 text-[var(--color-primary)]"
            >
              {t.text}
            </span>
          ),
        )}
      </span>
      <input
        ref={(el) => {
          syncScroll(el);
          if (inputRef) {
            if (typeof inputRef === 'function') inputRef(el);
            else (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
          }
        }}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => syncScroll(e.currentTarget)}
        placeholder={placeholder}
        className="relative w-full bg-transparent text-transparent [-webkit-text-fill-color:transparent] caret-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
      />
    </div>
  );
}

/**
 * The "only what is actually set" chip row + the dashed `+ Priority,
 * labels…` chip that opens the full picker set in a popover. Every chip is a
 * trigger, so tapping a set chip re-opens the pickers to edit it.
 */
function SetChips({
  parsed,
  projects,
  projectId,
  setProjectId,
  dueDate,
  setDueDate,
  priority,
  setPriority,
  labelTitles,
  setLabelTitles,
  reminders,
  setReminders,
  repeatAfter,
  repeatMode,
  onChangeRepeat,
  className,
}: {
  parsed: QuickAddResult;
  projects: Project[];
  projectId: string | null;
  setProjectId: (v: string | null) => void;
  dueDate: string | null;
  setDueDate: (v: string | null) => void;
  priority: number;
  setPriority: (v: number) => void;
  labelTitles: string[];
  setLabelTitles: (v: string[]) => void;
  reminders: AddReminderInput[];
  setReminders: (v: AddReminderInput[]) => void;
  repeatAfter: number | null;
  repeatMode: number | null;
  onChangeRepeat: (after: number | null, mode: number | null) => void;
  className?: string;
}) {
  const resolvedProject =
    parsed.projectTitle ??
    (projectId ? projects.find((p) => p.localId === projectId)?.title : null);
  const resolvedProjectColor = parsed.projectTitle
    ? null
    : projects.find((p) => p.localId === projectId)?.hexColor ?? null;

  const chips = (
    <>
      {dueDate ? (
        <span className="chip">
          <CalendarDays className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {formatDue(dueDate)}
        </span>
      ) : null}
      {priority > 0 ? (
        <span className="chip">
          <span
            className="h-3 w-[3px] rounded-full"
            style={{ backgroundColor: priorityColor(priority) }}
          />
          !{priority}
        </span>
      ) : null}
      {labelTitles.map((t) => (
        <span key={t} className="chip">
          <Tag className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {t}
        </span>
      ))}
      {reminders.length > 0 ? (
        <span className="chip">
          <Bell className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {reminders.length} reminder{reminders.length === 1 ? '' : 's'}
        </span>
      ) : null}
      {repeatAfter !== null || repeatMode !== null ? (
        <span className="chip">{repeatLabel(repeatAfter, repeatMode)}</span>
      ) : null}
      {resolvedProject ? (
        <span className="chip">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
            style={resolvedProjectColor ? { backgroundColor: resolvedProjectColor } : undefined}
          />
          {resolvedProject}
        </span>
      ) : null}
    </>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div
          className={cn(
            'flex cursor-pointer flex-wrap items-center gap-1.5',
            className,
          )}
        >
          {chips}
          <span className="chip-dashed">+ Priority, labels…</span>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-max max-w-[320px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <DatePicker value={dueDate} onChange={setDueDate} placeholder="Date" enableTime smart />
          <LabelPicker value={labelTitles} onChange={setLabelTitles} />
          <PrioritySelect value={priority} onChange={setPriority} variant="pill" />
          <ReminderPill value={reminders} onChange={setReminders} />
          <RecurrencePicker
            repeatAfter={repeatAfter}
            repeatMode={repeatMode}
            onChange={onChangeRepeat}
          />
          {projects.length > 0 ? (
            <Select value={projectId ?? ''} onValueChange={(v) => setProjectId(v || null)}>
              <SelectTrigger
                className="inline-flex h-auto w-auto min-w-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)] [&>span]:truncate"
                aria-label="Project"
              >
                <SelectValue placeholder="Inbox" />
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
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── the modal ───────────────────────────────────────────────────────────── */

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
  const { data: user } = useCurrentUser();
  // Seeded lazily by the effect below, which validates selectedProjectId
  // against the selectable project list — the open view can be a saved
  // filter's pseudo-project, which isn't a real create destination.
  const [projectId, setProjectId] = useState<string | null>(null);
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

  // Pick the target project once: the open project wins, else the user's
  // configured default project (#61, server `default_project_id`), else the
  // first project. One effect so the fallbacks can't race each other.
  useEffect(() => {
    if (projectId || projects.length === 0) return;
    // selectedProjectId can point at a pseudo-project (Favorites, or a
    // saved filter) that useSelectableProjects deliberately excludes —
    // those aren't real create destinations, so fall through to the
    // user's default / first project instead of using them.
    if (selectedProjectId && projects.some((p) => p.localId === selectedProjectId)) {
      setProjectId(selectedProjectId);
      return;
    }
    const def = user?.defaultProjectId
      ? projects.find((p) => p.serverId === user.defaultProjectId)
      : undefined;
    setProjectId((def ?? projects[0]!).localId);
  }, [projectId, projects, selectedProjectId, user?.defaultProjectId]);

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

  const doAdd = async (): Promise<boolean> => {
    if (!parsed.title) return false;
    // Need a project only when no +project token was typed (dropdown project).
    if (!parsed.projectTitle && !projectId) return false;
    if (submitting) return false;

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

      return true;
    } catch (err) {
      console.error('Quick add failed', err);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setText('');
    setDescription('');
    setPriority(0);
    setDueDate(null);
    setLabelTitles([]);
    setRepeatAfter(null);
    setRepeatMode(null);
    setReminders([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await doAdd()) onClose();
  };

  const handleTitleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ⇧⏎ adds and keeps the field open for the next task.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (await doAdd()) resetForm();
    }
  };

  const submitDisabled = submitting || !parsed.title || (!parsed.projectTitle && !projectId);

  const chipProps = {
    parsed,
    projects,
    projectId,
    setProjectId,
    dueDate,
    setDueDate,
    priority,
    setPriority,
    labelTitles,
    setLabelTitles,
    reminders,
    setReminders,
    repeatAfter,
    repeatMode,
    onChangeRepeat: (after: number | null, mode: number | null) => {
      setRepeatAfter(after);
      setRepeatMode(mode);
    },
  };

  if (isMobile) {
    // Capture sheet: a solid card anchored to the bottom (lifted above the
    // keyboard) with a 21px token-highlighted Task-name field, a muted
    // note line, only-set chips + dashed affordance, and a syntax-hint
    // footer with a 46px ink send button.
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
            'relative z-10 w-full rounded-t-[22px] bg-[var(--color-card)] pt-2.5 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)] dark:border dark:border-[oklch(34%_0.008_265)]',
            dragY === 0 && !drag.current.active && 'animate-[sheet-up_300ms_var(--spring-snappy)]',
          )}
          style={{
            marginBottom: keyboardInset,
            transform: dragY ? `translateY(${dragY}px)` : undefined,
            transition: drag.current.active ? 'none' : 'transform 240ms var(--spring-snappy)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-1 h-[5px] w-[38px] rounded-full bg-[var(--color-muted-foreground)]/30" />
          <form onSubmit={handleSubmit}>
            <div className="px-5 pt-3">
              <TokenInput
                value={text}
                parsed={parsed}
                onChange={setText}
                onKeyDown={handleTitleKeyDown}
                inputRef={titleRef}
                placeholder="Task name"
                className="text-[21px] font-medium leading-[1.35] tracking-[-0.015em]"
              />
              <input
                type="text"
                placeholder="Add a note…"
                className="mt-2 w-full bg-transparent text-[15px] text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="mt-4 px-5 pb-4">
              <SetChips {...chipProps} />
            </div>

            {/* Footer — syntax hint (left) + camera & 46px ink send (right). */}
            <div
              className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-3"
              style={{ paddingBottom: keyboardInset ? undefined : 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
            >
              <span className="text-[12.5px] text-[var(--color-muted-foreground)]">
                <code className="font-mono text-[var(--color-primary)]">+project</code>
                <span className="mx-1.5">·</span>
                <code className="font-mono text-[var(--color-primary)]">*label</code>
                <span className="mx-1.5">·</span>
                <code className="font-mono text-[var(--color-primary)]">!2</code>
              </span>
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
                  disabled={submitDisabled}
                  aria-label="Add task"
                  className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[var(--color-inverse)] text-[var(--color-inverse-foreground)] disabled:opacity-40"
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-[oklch(22% 0.012 265 / 0.34)] pt-[70px]"
      onClick={onClose}
    >
      <div
        className="w-[560px] rounded-[14px] bg-[var(--color-card)] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.4)] dark:border dark:border-[oklch(34%_0.008_265)]"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="px-5 pt-5">
            <TokenInput
              value={text}
              parsed={parsed}
              onChange={setText}
              onKeyDown={handleTitleKeyDown}
              inputRef={titleRef}
              placeholder="Buy milk tomorrow *groceries !2 @alice +Personal"
              className="text-[19px] font-semibold tracking-[-0.015em]"
            />
          </div>

          <div className="px-5 py-4">
            <SetChips {...chipProps} />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
            <span className="text-[11.5px] text-[var(--color-muted-foreground)]">
              ⏎ add · ⇧⏎ add &amp; keep open · esc cancel
            </span>
            <button
              type="submit"
              disabled={submitDisabled}
              className="rounded-md bg-[var(--color-inverse)] px-4 py-2 text-[13px] font-semibold text-[var(--color-inverse-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
