import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '@/stores/ui';
import { useSelectableProjects } from '@/queries/projects';
import { useCurrentUser } from '@/queries/user';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { useIsMobile } from '@/lib/useIsMobile';
import type { AddReminderInput } from '@/db/reminders';
import {
  buildQuickAddInput,
  canSubmitQuickAdd,
  persistQuickAdd,
} from '@/lib/quickAddSubmit';
import { pickFallbackProjectId } from '@/lib/quickAddProject';
import {
  useBodyScrollLock,
  useEscapeKey,
  useKeyboardInset,
  useSheetDrag,
} from '@/components/quick-add/useSheetBehaviour';
import { useQuickAddMirror } from '@/components/quick-add/useQuickAddMirror';
import { DesktopQuickAdd, MobileQuickAdd } from '@/components/quick-add/QuickAddViews';

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

  // Resolve #project token — match case-insensitive against project titles
  const parsed = useMemo(() => parseQuickAdd(text), [text]);

  useQuickAddMirror({
    parsed,
    projects,
    setPriority,
    setDueDate,
    setLabelTitles,
    setRepeatAfter,
    setRepeatMode,
    setProjectId,
  });

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
    titleRef,
    onTitleKeyDown: handleTitleKeyDown,
    onSubmit: handleSubmit,
    onClose,
    submitDisabled,
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
      />
    );
  }

  return <DesktopQuickAdd {...viewProps} submitting={submitting} />;
}
