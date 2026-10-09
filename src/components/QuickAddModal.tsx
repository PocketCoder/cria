import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '@/stores/ui';
import { useSettings } from '@/stores/settings';
import { useSelectableProjects } from '@/queries/projects';
import { useCurrentUser } from '@/queries/user';
import { parseQuickAddTask } from '@/lib/quickAddParser';
import { useIsMobile } from '@/lib/useIsMobile';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import type { AddReminderInput } from '@/db/reminders';
import {
  buildQuickAddInput,
  canSubmitQuickAdd,
  followParsed,
  followParsedLabels,
  persistQuickAdd,
} from '@/lib/quickAddSubmit';
import { findProjectByTitle, pickFallbackProjectId } from '@/lib/quickAddProject';
import {
  useBodyScrollLock,
  useEscapeKey,
  useKeyboardInset,
  useSheetDrag,
} from '@/components/quick-add/useSheetBehaviour';
import { DesktopQuickAdd, MobileQuickAdd } from '@/components/quick-add/QuickAddViews';
import { ModalDialog } from '@/components/ui/modal-dialog';

/** The repeat picker's value: `repeat_after` seconds and `repeat_mode`. */
interface Repeat {
  after: number | null;
  mode: number | null;
}

const NO_REPEAT: Repeat = { after: null, mode: null };

const sameRepeat = (a: Repeat, b: Repeat) => a.after === b.after && a.mode === b.mode;

/* ─── the modal ───────────────────────────────────────────────────────────── */

/**
 * A native modal dialog, so it stacks above any other open dialog (Outbox,
 * Display sheet…) instead of sitting inert underneath. The body mounts only once
 * the dialog is open, so its focus-on-mount and touch listeners find their nodes.
 */
export function QuickAddModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalDialog label="Add task" onClose={onClose}>
      <QuickAddBody onClose={onClose} />
    </ModalDialog>
  );
}

function QuickAddBody({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(0);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [labelTitles, setLabelTitles] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<Repeat>(NO_REPEAT);
  const [reminders, setReminders] = useState<AddReminderInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const activeView = useUi((s) => s.activeView);
  const setPhotoCaptureOpen = useUi((s) => s.setPhotoCaptureOpen);
  const aiAvailable = useAiAvailable();
  const selectedProjectId =
    activeView?.kind === 'project' ? activeView.localId : null;
  const { data: projects = [] } = useSelectableProjects();
  const { data: user } = useCurrentUser();
  // Explicit project choice; falls back to `fallbackProjectId` below.
  const [chosenProjectId, setProjectId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  // Focus the title without letting iOS scroll the page to it (that's what
  // dragged the background up when the sheet opened). `autoFocus` always
  // scroll-into-views; `focus({ preventScroll })` doesn't.
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useBodyScrollLock();
  const { panelRef, drag, dragY } = useSheetDrag(isMobile, onClose);
  const keyboardInset = useKeyboardInset();

  // Target project: an explicit choice (dropdown / +project token) wins, else
  // the open project, else the user's configured default project (#61, server
  // `default_project_id`), else the first project. Derived, not synced via an
  // effect, so there is no effect chain. selectedProjectId can point at a
  // pseudo-project (Favorites, or a saved filter) that useSelectableProjects
  // deliberately excludes — those aren't real create destinations, so fall
  // through to the default / first project instead of using them.
  const fallbackProjectId = useMemo(
    () => pickFallbackProjectId(projects, selectedProjectId, user?.defaultProjectId),
    [projects, selectedProjectId, user?.defaultProjectId],
  );
  const projectId = chosenProjectId ?? fallbackProjectId;

  // Parse with the user's Quick Add Magic mode (Vikunja / Todoist prefixes, or
  // off). The project token is matched case-insensitively against titles below.
  // A line that is only tokens stays a literal title, as in Vikunja-web.
  const magicMode = useSettings((s) => s.quickAddMagicMode);
  const parsed = useMemo(() => parseQuickAddTask(text, new Date(), magicMode), [text, magicMode]);

  // Mirror typed tokens into the pickers, so NL and the pickers stay in sync.
  // Each effect fires only when its parsed value changes, so a manual picker
  // choice afterwards isn't clobbered on the next keystroke. Each ref holds
  // what the parse last put in, so a value whose token goes away (deleted, or
  // the line became a literal title) leaves its picker too, unless the user
  // has changed that picker since (see followParsed).

  // A typed `!N` priority token → the button group.
  const parsedPriority = useRef<number | null>(null);
  useEffect(() => {
    const before = parsedPriority.current;
    const after = parsed.priority;
    parsedPriority.current = after;
    setPriority((p) => followParsed(p, before, after, 0));
  }, [parsed.priority]);

  // A typed date ("tomorrow", "next fri") → the date picker.
  const parsedDue = useRef<string | null>(null);
  useEffect(() => {
    const before = parsedDue.current;
    const after = parsed.dueDate;
    parsedDue.current = after;
    setDueDate((d) => followParsed(d, before, after, null));
  }, [parsed.dueDate]);

  // Typed `*label` tokens → the label picker, unioned with manual picks. Keyed
  // on the joined titles so it only fires when they change; the latest titles
  // are read through a ref.
  const parsedLabelsKey = parsed.labelTitles.join(' ');
  const latestLabels = useRef(parsed.labelTitles);
  useEffect(() => {
    latestLabels.current = parsed.labelTitles;
  });
  const parsedLabels = useRef<string[]>([]);
  useEffect(() => {
    const before = parsedLabels.current;
    const after = latestLabels.current;
    parsedLabels.current = after;
    if (before.length === 0 && after.length === 0) return;
    setLabelTitles((prev) => followParsedLabels(prev, before, after));
  }, [parsedLabelsKey]);

  // A typed recurrence ("every 2 weeks", "monthly") → the repeat picker.
  const parsedRepeat = useRef<Repeat | null>(null);
  useEffect(() => {
    const before = parsedRepeat.current;
    const after =
      parsed.repeatAfter !== null || parsed.repeatMode !== null
        ? { after: parsed.repeatAfter, mode: parsed.repeatMode }
        : null;
    parsedRepeat.current = after;
    setRepeat((r) => followParsed(r, before, after, NO_REPEAT, sameRepeat));
  }, [parsed.repeatAfter, parsed.repeatMode]);

  // A typed project token → the project dropdown, once projects have loaded.
  const parsedProject = useRef<string | null>(null);
  useEffect(() => {
    if (projects.length === 0) return;
    const before = parsedProject.current;
    const match = parsed.projectTitle ? findProjectByTitle(projects, parsed.projectTitle) : undefined;
    const after = match?.localId ?? null;
    parsedProject.current = after;
    setProjectId((id) => followParsed(id, before, after, null));
  }, [parsed.projectTitle, projects]);

  useEscapeKey(onClose);

  const doAdd = async (): Promise<boolean> => {
    if (!canSubmitQuickAdd(parsed, projectId)) return false;
    if (submitting) return false;

    setSubmitting(true);
    try {
      const input = buildQuickAddInput(parsed, projects, projectId, {
        description,
        dueDate,
        priority,
        repeatAfter: repeat.after,
        repeatMode: repeat.mode,
      });
      await persistQuickAdd(input, labelTitles, reminders, parsed.assigneeUsernames);
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
    setRepeat(NO_REPEAT);
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

  const disabledReason = submitting
    ? 'busy'
    : !parsed.title
      ? 'no title'
      : !parsed.projectTitle && !projectId
        ? 'no project'
        : undefined;

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
    repeatAfter: repeat.after,
    repeatMode: repeat.mode,
    onChangeRepeat: (after: number | null, mode: number | null) => setRepeat({ after, mode }),
  };

  const viewProps = {
    text,
    setText,
    parsed,
    magicMode,
    titleRef,
    onTitleKeyDown: handleTitleKeyDown,
    onSubmit: handleSubmit,
    onClose,
    submitDisabled,
    disabledReason,
    chipProps,
  };

  if (isMobile) {
    return (
      <MobileQuickAdd
        {...viewProps}
        description={description}
        setDescription={setDescription}
        panelRef={panelRef}
        drag={drag}
        dragY={dragY}
        keyboardInset={keyboardInset}
        onOpenPhotoCapture={() => {
          onClose();
          setPhotoCaptureOpen(true);
        }}
        onOpenRamble={
          aiAvailable
            ? () => {
                // Carry over anything already typed.
                const ui = useUi.getState();
                if (text.trim() && !ui.rambleDraft.trim()) ui.setRambleDraft(text);
                onClose();
                ui.setRambleOpen(true);
              }
            : undefined
        }
      />
    );
  }

  return <DesktopQuickAdd {...viewProps} submitting={submitting} />;
}
