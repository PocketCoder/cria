import { useCallback, useState } from 'react';
import { dayToIso } from './buildGanttTaskTree';

/**
 * Gantt date-range + dateless visibility, persisted globally to
 * localStorage (matching Vikunja, which syncs these to the URL/query). The
 * default window is today−7d … today+55d; the chart scrolls to centre on
 * today on first render.
 */
export interface GanttFilters {
  /** Inclusive range start, midnight-UTC ISO. */
  dateFrom: string;
  /** Inclusive range end, midnight-UTC ISO. */
  dateTo: string;
  showTasksWithoutDates: boolean;
  showCompleted: boolean;
}

const KEY = 'cria:ganttFilters';

function todayDay(): number {
  return Math.floor(Date.now() / 86400000);
}

function defaults(): GanttFilters {
  const t = todayDay();
  return {
    dateFrom: dayToIso(t - 7),
    dateTo: dayToIso(t + 55),
    // Default on: many local tasks lack start/end, and an empty chart reads
    // as broken. Users can hide them with the toggle.
    showTasksWithoutDates: true,
    showCompleted: false,
  };
}

function load(): GanttFilters {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<GanttFilters>) };
  } catch {
    /* ignore */
  }
  return defaults();
}

function persist(value: GanttFilters): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY, JSON.stringify(value));
    }
  } catch {
    /* storage unavailable */
  }
}

export interface GanttFiltersApi {
  filters: GanttFilters;
  setDateFrom: (iso: string | null) => void;
  setDateTo: (iso: string | null) => void;
  toggleDateless: () => void;
  toggleCompleted: () => void;
  reset: () => void;
}

export function useGanttFilters(): GanttFiltersApi {
  const [filters, setFilters] = useState<GanttFilters>(load);

  const update = useCallback((patch: Partial<GanttFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);

  const setDateFrom = useCallback(
    (iso: string | null) => {
      if (iso) update({ dateFrom: iso });
    },
    [update],
  );
  const setDateTo = useCallback(
    (iso: string | null) => {
      if (iso) update({ dateTo: iso });
    },
    [update],
  );
  const toggleDateless = useCallback(() => {
    setFilters((prev) => {
      const next = { ...prev, showTasksWithoutDates: !prev.showTasksWithoutDates };
      persist(next);
      return next;
    });
  }, []);
  const toggleCompleted = useCallback(() => {
    setFilters((prev) => {
      const next = { ...prev, showCompleted: !prev.showCompleted };
      persist(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    const d = defaults();
    persist(d);
    setFilters(d);
  }, []);

  return { filters, setDateFrom, setDateTo, toggleDateless, toggleCompleted, reset };
}
