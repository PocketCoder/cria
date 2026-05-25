import { createTask, deleteTask } from '@/db/tasks';
import { getDb } from '@/db';
import { drainOutbox } from '@/sync/push';

async function main(){
  const db = await getDb();
  const projects = await db.select<any[]>('SELECT local_id FROM projects LIMIT 1');
  if (!projects[0]) {
    console.log('No project in DB – abort');
    return;
  }
  const projectLocalId = projects[0].local_id;
  console.log('Using projectLocalId', projectLocalId);

  const task = await createTask({title:'debug task', projectLocalId});
  console.log('Created task', task.local_id);
  await deleteTask(task.local_id);
  console.log('Deleted task');
  await drainOutbox();
  const outRows = await db.select<any[]>('SELECT * FROM outbox');
  console.log('Outbox rows after drain:', outRows.length);
}

main().catch(e=>console.error(e));
