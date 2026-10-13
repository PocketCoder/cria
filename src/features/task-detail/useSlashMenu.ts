import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { filterCommands } from './editorCommands';
import { matchSlashQuery } from './editorLogic';

interface SlashUI {
  open: boolean;
  query: string;
  coords: { top: number; left: number };
  selectedIndex: number;
}

/**
 * Slash command menu state. Managed via a ref to avoid stale closures in
 * TipTap callbacks, and synced to UI state for React rendering.
 */
export function useSlashMenu() {
  const slashStateRef = useRef({
    open: false,
    query: '',
    coords: { top: 0, left: 0 },
    selectedIndex: 0,
    filteredCommandsCount: 0,
  });

  const [slashUI, setSlashUI] = useState<SlashUI>({
    open: false,
    query: '',
    coords: { top: 0, left: 0 },
    selectedIndex: 0,
  });

  const updateSlashState = (updates: Partial<SlashUI> & { filteredCommandsCount?: number }) => {
    slashStateRef.current = {
      ...slashStateRef.current,
      ...updates,
    };
    setSlashUI({
      open: slashStateRef.current.open,
      query: slashStateRef.current.query,
      coords: slashStateRef.current.coords,
      selectedIndex: slashStateRef.current.selectedIndex,
    });
  };

  const checkSlash = (editorInstance: Editor) => {
    const { selection } = editorInstance.state;
    const { $from } = selection;

    if (!$from.parent.isTextblock) {
      updateSlashState({ open: false });
      return;
    }

    const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, null, '\0');
    const query = matchSlashQuery(textBeforeCursor);

    if (query === null) {
      updateSlashState({ open: false });
      return;
    }

    try {
      const coords = editorInstance.view.coordsAtPos(selection.from);
      updateSlashState({
        open: true,
        query,
        coords: { top: coords.bottom, left: coords.left },
        selectedIndex: 0,
        filteredCommandsCount: filterCommands(query).length,
      });
    } catch {
      updateSlashState({ open: false });
    }
  };

  const executeSlashCommand = (index: number, editorInstance: Editor) => {
    const query = slashStateRef.current.query;
    const { selection } = editorInstance.state;
    const start = selection.from - (query.length + 1);

    const cmd = filterCommands(query)[index];
    if (cmd) {
      editorInstance
        .chain()
        .focus()
        .deleteRange({ from: start, to: selection.from })
        .run();

      cmd.action(editorInstance);
    }
    updateSlashState({ open: false });
  };

  return { slashStateRef, slashUI, updateSlashState, checkSlash, executeSlashCommand };
}
