import { useState, useEffect } from 'react';
import { addDays, isSameDay, startOfDay } from 'date-fns';
import { onVisibilityChange } from '@/lib/visibility';

/**
 * Local start of the current day, rolling over at midnight while the app stays
 * open. The reference only changes when the day does, so it is safe in memo
 * deps. A timeout can be late or dropped while the app is suspended (iOS), so
 * the day is also re-checked when the page returns to the foreground.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const now = startOfDay(new Date());
      setToday((prev) => (isSameDay(prev, now) ? prev : now));
    };
    const arm = () => {
      clearTimeout(timer);
      const now = new Date();
      timer = setTimeout(() => {
        sync();
        arm();
      }, addDays(startOfDay(now), 1).getTime() - now.getTime());
    };
    arm();
    // The day may have changed while hidden; re-check and re-arm on return.
    const stop = onVisibilityChange({
      onShow: () => {
        sync();
        arm();
      },
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);

  return today;
}
