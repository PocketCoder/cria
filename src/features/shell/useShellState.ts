import { useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isMobilePlatform } from '@/lib/platform';
import type { ActiveView } from '@/stores/ui';

/** Which shell-level modals are open. */
export function useShellModals() {
  const [showOutbox, setShowOutbox] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'teams' | undefined>(undefined);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [showViewManager, setShowViewManager] = useState(false);
  return {
    showOutbox,
    setShowOutbox,
    showConflicts,
    setShowConflicts,
    showQuickAdd,
    setShowQuickAdd,
    showSettings,
    setShowSettings,
    settingsTab,
    setSettingsTab,
    showCommandPalette,
    setShowCommandPalette,
    showLabelManager,
    setShowLabelManager,
    showViewManager,
    setShowViewManager,
  };
}

export type ShellModals = ReturnType<typeof useShellModals>;

/** Header search box state; entering a query swaps the view to search and restores it on clear. */
export function useShellSearch(
  activeView: ActiveView | null,
  setActiveView: (view: ActiveView | null) => void,
) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevViewRef = useRef<ActiveView | null>(null);

  // Leave the search view. The mobile overlay can be cancelled before anything
  // is typed, so there may be no remembered view (and phones have no sidebar
  // to pick one from): fall back to Today rather than a blank pane.
  const leaveSearch = () => {
    if (activeView?.kind === 'search' || prevViewRef.current) {
      setActiveView(prevViewRef.current ?? { kind: 'today' });
    }
    prevViewRef.current = null;
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setSearchQuery(v);
    if (v.trim() && activeView?.kind !== 'search') {
      prevViewRef.current = activeView;
      setActiveView({ kind: 'search' });
    } else if (!v.trim() && activeView?.kind === 'search') {
      leaveSearch();
    }
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    leaveSearch();
    setMobileSearchOpen(false);
    searchInputRef.current?.focus();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleSearchClear();
    }
  };

  return {
    mobileSearchOpen,
    setMobileSearchOpen,
    searchQuery,
    searchInputRef,
    handleSearchChange,
    handleSearchClear,
    handleSearchKeyDown,
  };
}

export type ShellSearch = ReturnType<typeof useShellSearch>;

/**
 * Desktop-only: drag the frameless window by its sidebar drag strip. There's
 * no window chrome to drag on mobile, so this is a no-op there.
 */
export function useHeaderDrag() {
  return (e: React.MouseEvent) => {
    if (isMobilePlatform()) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, button, a, [role="button"], textarea, select')) return;
    getCurrentWindow().startDragging().catch(() => {});
  };
}
