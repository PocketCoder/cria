import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { useTaskLabels } from '@/queries/taskLabels';
import { priorityColor } from '@/components/ui/priority-select';
import { LabelChips } from './LabelChips';
import type { Task } from '@/domain/task';

const HOVER_DELAY = 800;
const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 200;
const PREVIEW_CHARS = 150;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

interface TaskHoverPreviewProps {
  task: Task;
  children: ReactNode;
}

export function TaskHoverPreview({ task, children }: TaskHoverPreviewProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const { data: labels = [] } = useTaskLabels(isOpen ? task.localId : null);

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return null;
    const rect = triggerRef.current.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left;

    if (left + POPUP_WIDTH > window.innerWidth - 16) {
      left = window.innerWidth - POPUP_WIDTH - 16;
    }
    left = Math.max(8, left);

    if (top + POPUP_HEIGHT > window.innerHeight - 8) {
      top = rect.top - POPUP_HEIGHT - 8;
    }

    return { top, left };
  }, []);

  const show = useCallback(() => {
    const p = calcPos();
    if (!p) return;
    setPos(p);
    setIsOpen(true);
  }, [calcPos]);

  useEffect(() => {
    if (!isOpen) return;
    const onMove = () => {
      const p = calcPos();
      if (p) setPos(p);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [isOpen, calcPos]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(show, HOVER_DELAY);
  }, [show]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(timerRef.current);
    setIsOpen(false);
  }, []);

  const descPreview = task.description
    ? truncate(stripHtml(task.description), PREVIEW_CHARS)
    : null;

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {isOpen && createPortal(
        <div
          className="fixed z-[9999] w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-lg"
          style={{ top: pos.top, left: pos.left, pointerEvents: 'none' }}
        >
          <p className="mb-1 text-sm font-medium leading-snug">
            {task.identifier ? (
              <span className="text-[var(--color-muted-foreground)]">{task.identifier} </span>
            ) : null}
            {task.title}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-caption text-[var(--color-muted-foreground)]">
            {task.dueDate ? (
              <span>Due {format(new Date(task.dueDate), 'd MMM')}</span>
            ) : null}
            {task.priority > 0 ? (
              <span style={{ color: priorityColor(task.priority) }}>{'!'.repeat(Math.min(5, task.priority))}</span>
            ) : null}
            {labels.length > 0 ? (
              <LabelChips labels={labels} />
            ) : null}
          </div>
          {descPreview ? (
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted-foreground)] line-clamp-3">
              {descPreview}
            </p>
          ) : null}
        </div>,
        document.body
      )}
    </>
  );
}
