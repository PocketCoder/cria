import { useOutboxCount } from '@/queries/outbox';
import { useConflictsCount } from '@/queries/conflicts';

/** Simple visible status indicator (fallback for dev when real tray unavailable) */
export function TrayStatus() {
  const { data: outbox = 0 } = useOutboxCount();
  const { data: conflicts = 0 } = useConflictsCount();

  let status = 'Idle';
  let color = 'bg-green-500';
  if (conflicts > 0) {
    status = `Conflicts: ${conflicts}`;
    color = 'bg-amber-500';
  } else if (outbox > 0) {
    status = `Pending: ${outbox}`;
    color = 'bg-amber-500';
  }

  return (
    <div className={`px-2 py-1 rounded text-white text-xs ${color} ml-2`}> {status} </div>
  );
}
