import { useEffect, useRef } from 'react';
import type { QuickAddResult } from '@/lib/quickAddParser';
import { findProjectByTitle } from '@/lib/quickAddProject';
import { mergeLabelTitles } from '@/lib/quickAddSubmit';
import type { Project } from '@/domain/project';

interface Mirror {
  parsed: QuickAddResult;
  projects: Project[];
  setPriority: (v: number) => void;
  setDueDate: (v: string | null) => void;
  setLabelTitles: (updater: (prev: string[]) => string[]) => void;
  setRepeatAfter: (v: number | null) => void;
  setRepeatMode: (v: number | null) => void;
  setProjectId: (v: string | null) => void;
}

/**
 * Mirror typed natural-language tokens into the pickers so NL and the picker
 * stay in sync. Each effect only fires when its parsed value changes, so a
 * manual picker choice afterwards isn't clobbered on the next keystroke.
 */
export function useQuickAddMirror({
  parsed,
  projects,
  setPriority,
  setDueDate,
  setLabelTitles,
  setRepeatAfter,
  setRepeatMode,
  setProjectId,
}: Mirror): void {
  // `!N` priority token → button group.
  useEffect(() => {
    if (parsed.priority !== null) setPriority(parsed.priority);
  }, [parsed.priority, setPriority]);

  // Typed date ("tomorrow", "next fri") → date picker.
  useEffect(() => {
    if (parsed.dueDate) setDueDate(parsed.dueDate);
  }, [parsed.dueDate, setDueDate]);

  // Merge typed `*label` tokens into the label picker (union, so manual picks
  // aren't lost). Keyed on the joined titles so it only fires when they change.
  const parsedLabelsKey = parsed.labelTitles.join(' ');
  const latestLabels = useRef(parsed.labelTitles);
  useEffect(() => {
    latestLabels.current = parsed.labelTitles;
  });
  useEffect(() => {
    const incoming = latestLabels.current;
    if (incoming.length === 0) return;
    setLabelTitles((prev) => mergeLabelTitles(prev, incoming));
  }, [parsedLabelsKey, setLabelTitles]);

  // Typed recurrence ("every 2 weeks", "monthly") → picker.
  useEffect(() => {
    if (parsed.repeatAfter !== null || parsed.repeatMode !== null) {
      setRepeatAfter(parsed.repeatAfter);
      setRepeatMode(parsed.repeatMode);
    }
  }, [parsed.repeatAfter, parsed.repeatMode, setRepeatAfter, setRepeatMode]);

  // `+project` token → project dropdown.
  useEffect(() => {
    if (parsed.projectTitle && projects.length > 0) {
      const match = findProjectByTitle(projects, parsed.projectTitle);
      if (match) setProjectId(match.localId);
    }
  }, [parsed.projectTitle, projects, setProjectId]);
}
