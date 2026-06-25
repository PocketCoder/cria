import { pullProjects, pullLabels, pullAllTasks, pullAllViews, pullAllBuckets } from './pull';
import { drainOutbox } from './push';
import { notify } from '@/db/bus';
import { useSyncProgress } from '@/stores/syncProgress';

async function step<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  useSyncProgress.getState().setStep(label);
  try {
    const result = await fn();
    return result;
  } catch (err) {
    useSyncProgress.getState().addError(label, String(err));
    console.warn(`[forceSync] ${label.toLowerCase()} failed:`, err);
    return undefined;
  }
}

/**
 * Trigger a full manual sync: drain outbox, pull all entities, notify the
 * bus so query hooks refresh. Catches individual step errors so a flaky
 * server doesn't abort the whole cycle.
 */
export async function forceSync(): Promise<void> {
  await step('Pushing local changes…', drainOutbox);
  await step('Fetching projects…', async () => {
    await pullProjects();
    notify('projects');
  });
  await step('Fetching labels…', async () => {
    await pullLabels();
    notify('labels');
  });
  await step('Fetching tasks…', async () => {
    await pullAllTasks();
    notify('tasks');
  });
  await step('Fetching views…', async () => {
    await pullAllViews();
    await pullAllBuckets();
    notify('views');
  });
  useSyncProgress.getState().setStep(null);
}
