import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '@/stores/ui';
import { useSettings } from '@/stores/settings';
import { useSelectableProjects } from '@/queries/projects';
import { useCurrentUser } from '@/queries/user';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { useIsMobile } from '@/lib/useIsMobile';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import type { AddReminderInput } from '@/db/reminders';
import {
  buildQuickAddInput,
  canSubmitQuickAdd,
  mergeLabelTitles,
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
  const [repeatAfter, setRepeatAfter] = useState<number | null>(null);
  const [repeatMode, setRepeatMode] = useState<number | null>(null);
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
  const magicMode = useSettings((s) => s.quickAddMagicMode);
  const parsed = useMemo(() => parseQuickAdd(text, new Date(), magicMode), [text, magicMode]);

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
  // aren't lost). Keyed on the joined titles so it only fires when they change;
  // the latest titles are read through a ref.
  const parsedLabelsKey = parsed.labelTitles.join(' ');
  const latestLabels = useRef(parsed.labelTitles);
  useEffect(() => {
    latestLabels.current = parsed.labelTitles;
  });
  useEffect(() => {
    const incoming = latestLabels.current;
    if (incoming.length === 0) return;
    setLabelTitles((prev) => mergeLabelTitles(prev, incoming));
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
      const match = findProjectByTitle(projects, parsed.projectTitle);
      if (match) setProjectId(match.localId);
    }
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
        repeatAfter,
        repeatMode,
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
    repeatAfter,
    repeatMode,
    onChangeRepeat: (after: number | null, mode: number | null) => {
      setRepeatAfter(after);
      setRepeatMode(mode);
    },
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
