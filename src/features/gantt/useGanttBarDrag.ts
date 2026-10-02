import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLatestRef } from '@/lib/useLatestRef';
import { dayToIso } from './buildGanttTaskTree';
import { DAY_WIDTH_PIXELS, DRAG_THRESHOLD_PIXELS } from './constants';
import { applyDrag, type DragMode, type DragState } from './ganttGeometry';

interface Callbacks {
  onUpdateDates: (taskLocalId: string, startIso: string, endIso: string) => void;
  onOpenTask: (taskLocalId: string) => void;
}

/** Bar move/resize drag. A drag that never moved past the threshold is a click. */
export function useGanttBarDrag({ onUpdateDates, onOpenTask }: Callbacks) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useLatestRef<DragState | null>(drag);
  const cbRef = useLatestRef({ onUpdateDates, onOpenTask });
  const dragging = drag !== null;

  const startDrag = (
    taskLocalId: string,
    mode: DragMode,
    e: ReactPointerEvent,
    origStart: number,
    origEnd: number,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag({
      taskLocalId,
      mode,
      startClientX: e.clientX,
      origStart,
      origEnd,
      deltaDays: 0,
      moved: false,
    });
  };

  // Global pointer listeners live only while a drag is active.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaPx = e.clientX - d.startClientX;
      setDrag({
        ...d,
        deltaDays: Math.round(deltaPx / DAY_WIDTH_PIXELS),
        moved: d.moved || Math.abs(deltaPx) > DRAG_THRESHOLD_PIXELS,
      });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        if (d.moved) {
          const { start, end } = applyDrag(d);
          if (start !== d.origStart || end !== d.origEnd) {
            cbRef.current.onUpdateDates(d.taskLocalId, dayToIso(start), dayToIso(end));
          }
        } else {
          cbRef.current.onOpenTask(d.taskLocalId);
        }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, dragRef, cbRef]);

  return { drag, startDrag };
}
