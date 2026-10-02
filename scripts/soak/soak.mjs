// Usage: node scripts/soak/soak.mjs [loops=200]
// Repeats a user flow, forces GC, and compares DOM nodes / listeners / heap
// between a post-warmup baseline and the end. Fails on >=10 extra listeners
// or >=100 extra nodes (thresholds adapted from the article).
import { startVite, openApp } from './harness.mjs';

const LOOPS = Number(process.argv[2] ?? 200);
const WARMUP = 5;

const vite = await startVite();
const { browser, page } = await openApp(vite.url);
const nav = page.getByRole('navigation');

async function flow() {
  for (const v of ['Today', 'Upcoming', 'Inbox']) await nav.getByRole('button', { name: v, exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await nav.getByRole('button', { name: `Project ${i} 40` }).click();
    await page.getByText(`Task ${i}.${i + 1}`, { exact: true }).click(); // inspector read view
    await page.getByRole('button', { name: 'Edit description' }).click(); // → TipTap
    await page.locator('.ProseMirror').waitFor();
    await page.getByRole('button', { name: 'Close details' }).first().click();
    await page.locator('.ProseMirror').waitFor({ state: 'detached' });
  }
  for (const view of ['Kanban', 'Table', 'Gantt', 'List']) {
    await page.getByLabel('View', { exact: true }).getByText(view, { exact: true }).click();
  }
  await page.getByRole('button', { name: /^Search/ }).click();
  const q = page.getByPlaceholder(/Search tasks, actions/);
  await q.fill('task 2');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await q.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}

async function metrics(client) {
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.collectGarbage');
  const { metrics } = await client.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const extra = process.env.SOAK_DEBUG
    ? await client.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `[...document.body.querySelectorAll('*')].reduce((a, e) => { const k = e.closest('[role=dialog],[role=tooltip],[role=status],[role=alert],[data-radix-popper-content-wrapper],[data-sonner-toaster]')?.getAttribute('role') ?? e.closest('body > *')?.id ?? 'other'; a[k] = (a[k] ?? 0) + 1; return a; }, {})`,
      }).then((r) => ({ dom: r.result.value }))
    : {};
  return { ...extra, heapMB: +(m.JSHeapUsedSize / 2 ** 20).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents };
}

try {
  await nav.getByRole('button', { name: 'Today', exact: true }).waitFor();
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  for (let i = 0; i < WARMUP; i++) await flow();
  const samples = [{ loop: WARMUP, ...(await metrics(client)) }];
  console.log(samples[0]);
  for (let i = WARMUP; i < LOOPS; i++) {
    await flow();
    if ((i + 1) % 25 === 0) {
      const s = { loop: i + 1, ...(await metrics(client)) };
      samples.push(s);
      console.log(s);
    }
  }
  const [base, after] = [samples[0], samples.at(-1)];
  // ponytail: the article's strict `<=` on listeners flakes on one-off lazy
  // listeners (seen +1 once, then flat). A per-loop leak adds ~LOOPS, so a
  // small allowance still catches it.
  const ok = after.listeners < base.listeners + 10 && after.nodes < base.nodes + 100;
  console.log(JSON.stringify({ base, after, ok, samples }));
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  await page.screenshot({ path: process.env.SOAK_SHOT ?? 'soak-fail.png' });
  console.error(e.message.split('\n')[0]);
  process.exitCode = 2;
} finally {
  await browser.close();
  vite.stop();
}
