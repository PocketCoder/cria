import { useMemo, useState } from 'react';
import { createSavedFilter, updateSavedFilter } from '@/api/savedFilters';
import { useOnline } from '@/hooks/useOnline';
import type { SavedFilter } from '@/db/savedFilters';
import {
  buildFilterInput,
  canSaveFilter,
  filterParseError,
  initialFilterForm,
  type FilterForm,
} from './savedFilterLogic';

/** Form state, live query validation and the save call for the filter modal. */
export function useSavedFilterForm(existing: SavedFilter | null | undefined, onClose: () => void) {
  const online = useOnline();
  const [form, setForm] = useState<FilterForm>(() => initialFilterForm(existing));
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const setField = <K extends keyof FilterForm>(key: K, value: FilterForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const parseError = useMemo(() => filterParseError(form.query, new Date()), [form.query]);
  const canSave = canSaveFilter({
    online,
    busy,
    title: form.title,
    query: form.query,
    parseError,
  });

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setSaveError(null);
    try {
      const input = buildFilterInput(form);
      if (existing) {
        await updateSavedFilter(existing.serverId, input);
      } else {
        await createSavedFilter(input);
      }
      onClose();
    } catch (err) {
      console.error('[saved-filter] save failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setBusy(false);
    }
  };

  return { form, setField, online, busy, saveError, parseError, canSave, save };
}
