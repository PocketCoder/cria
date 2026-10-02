/**
 * Prompt builders and output parsers for the on-device model
 * (`generate()` in src/tauri/ai.ts). Pure: no DB, no React, no Tauri.
 *
 * Design rule: the model never does date maths. Small on-device models are
 * poor at it, so prompts ask for dates *in words* ("next friday") and the
 * existing quick-add / filter parsers resolve them.
 */

import { needsQuoting } from '@/lib/quickAddParser';

/** On-device context is 4K tokens on OS 26, 8K on OS 27; ~6K chars is safe. */
const MAX_INPUT_CHARS = 6000;
const MAX_NAMES = 50;

export function clip(text: string, max = MAX_INPUT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Keep the *end* (most recent) when clipping, e.g. comment threads. */
export function clipStart(text: string, max = MAX_INPUT_CHARS): string {
  return text.length > max ? `…${text.slice(text.length - max)}` : text;
}

function nameList(names: string[]): string {
  // Quote exactly the names the quick-add parser can't match bare (`+Café`).
  const shown = names.slice(0, MAX_NAMES).map((n) => (needsQuoting(n) ? `"${n}"` : n));
  return shown.length > 0 ? shown.join(', ') : '(none)';
}

/** Rich-text (TipTap/Vikunja HTML) → plain text for prompts. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Model output → one clean line per item. Strips bullets and numbering the
 * model adds despite being told not to, drops headings/labels like
 * "Output:", and dedupes case-insensitively. A leading `*label` (no space)
 * is a quick-add token, not a bullet, so it survives.
 */
export function parseLines(text: string, max = 50): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw
      .trim()
      .replace(/^(?:[-•–]\s+|\*\s+|\d+[.)]\s+)/, '')
      .replace(/^(?:output|tasks?|subtasks?|items?)\s*:\s*/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      // A title's trailing full stop (not an ellipsis), which small models add.
      .replace(/(?<!\.)\.$/, '')
      .trim();
    if (!line || line.endsWith(':')) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/* ─── Ramble: free speech → quick-add lines ─── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function rambleInstructions(ctx: { projects: string[]; labels: string[]; now?: Date }): string {
  const now = ctx.now ?? new Date();
  const today = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  // The date parser can't do "end of the month", so the model names the day;
  // the example shows it with this month's real last day.
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endOfMonth = `${MONTHS[lastDay.getMonth()]} ${lastDay.getDate()}`;
  return `You turn a person's spoken ramble into a to-do list. Today is ${today}.
Output one task per line and nothing else: no numbering, bullets, headings or commentary.
Each line is a short imperative task title, optionally followed by these tokens:
- A due date in plain words, as the person said it (tomorrow, tomorrow 5pm, next friday, in 3 days, this weekend). Keep every date the person mentions. Only for "end of the month/week" style deadlines, write the month and day instead (${endOfMonth}).
- A repeat in plain words (every week, daily, every monday).
- +Project to file it in a project. Only use these projects: ${nameList(ctx.projects)}. Put quotes around names with spaces or any character other than letters, digits, - and _, like +"Home Admin" or +"Mum's". Leave it out if none fits.
- *label to tag it. Existing labels: ${nameList(ctx.labels)}. Only add a label if it clearly fits.
- !3 only if the person says it is important, !4 only if they say it is urgent. Most tasks have no priority.
Write each title without a full stop at the end.
Skip filler, thinking aloud and anything that is not a task. Merge repeats of the same task.

Example ramble: ugh I need to call the dentist sometime next week, and email the landlord tomorrow, and um renew the car insurance before the end of the month, that's really important, oh and buy milk
Example output:
Call the dentist next week
Email the landlord tomorrow
Renew car insurance ${endOfMonth} !3
Buy milk`;
}

/* ─── Break a task into subtasks ─── */

export const SUBTASK_INSTRUCTIONS = `Break a task into 3 to 8 concrete, actionable subtasks, in the order they would be done.
Output one subtask per line and nothing else: short imperative titles with no full stop, and no numbering, bullets or commentary.
Do not repeat the parent task itself.`;

export function subtaskPrompt(title: string, descriptionHtml: string | null | undefined): string {
  const notes = descriptionHtml ? stripHtml(descriptionHtml) : '';
  return clip(notes ? `Task: ${title}\nNotes: ${notes}` : `Task: ${title}`);
}

/* ─── Natural language → Vikunja filter query ─── */

export function filterInstructions(ctx: { projects: string[]; labels: string[] }): string {
  return `Translate a request into a task filter query. Output only the query, on one line, with no explanation or code formatting.
Fields: done (true or false), priority (1 low to 5 highest), dueDate, startDate, endDate, labels, assignees, project.
Operators: = != > >= < <= like in, and "not in". Combine with && and ||, group with ( ).
Dates are compared with < > <= >= against now, now+7d, now-1w, now+1m, now+1y (d days, w weeks, m months, y years). Nothing else works for dates; a missing date can't be matched, so leave that part out.
Put text values in double quotes. labels and project take names, for example labels in "urgent", "work" or project = "Home".
Projects: ${nameList(ctx.projects)}
Labels: ${nameList(ctx.labels)}
Only add conditions the request asks for. Also add done = false unless the request is about finished or completed tasks.

Examples:
overdue -> done = false && dueDate < now
urgent things -> done = false && labels in "urgent"
high priority work stuff due in the next two weeks -> done = false && priority >= 3 && project = "Work" && dueDate > now && dueDate < now+2w
tasks in home or garden -> done = false && (project = "Home" || project = "Garden")
things I finished this month -> done = true && dueDate > now-1m`;
}

/** Model output → bare filter query (first line, no fences/backticks/prefix). */
export function cleanFilter(text: string): string {
  const line =
    text
      .replace(/```[a-z]*\n?/gi, '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  return line
    .replace(/^(?:query|filter)\s*:\s*/i, '')
    .replace(/^`+|`+$/g, '')
    .trim();
}

/* ─── Summarise a comment thread ─── */

export const SUMMARY_INSTRUCTIONS = `Summarise a task's comment thread in 2 to 4 short bullet points: decisions made, open questions, and who is waiting on what.
Plain text only. Start each line with "- ". No heading or preamble.`;

export function commentsPrompt(
  comments: Array<{ authorName: string | null; comment: string; createdAt: string | null }>,
): string {
  const lines = comments.map((c) => {
    const when = c.createdAt ? ` (${c.createdAt.slice(0, 10)})` : '';
    return `${c.authorName ?? 'Someone'}${when}: ${stripHtml(c.comment)}`;
  });
  return clipStart(lines.join('\n'));
}

/* ─── Tidy OCR'd list lines ─── */

export const TIDY_LIST_INSTRUCTIONS = `These lines were read from a photo of a list by OCR. They may have misread characters, items split across two lines, prices, headings and totals.
Return every list item, one per line. Keep every item: never leave one out.
- Fix obvious misreadings (lem0ns -> lemons).
- Join an item that was split across two lines (whole wheat / bread -> whole wheat bread).
- Remove prices from an item but keep the item (milk £1.20 -> milk).
- Keep quantities (2 lemons).
- Drop lines that are only a heading, a total or a price.
No numbering, bullets or commentary.

Example input:
GROCERIES
3 appels
oat milk 1.80
cheddar
cheese
TOTAL 9.40
Example output:
3 apples
oat milk
cheddar cheese`;

/* ─── Errors ─── */

/** Native error codes (see src-tauri/swift/CriaAI) → something a person can act on. */
export function aiErrorMessage(err: unknown): string {
  const msg = String(err instanceof Error ? err.message : err);
  if (msg.includes('appleIntelligenceNotEnabled'))
    return 'Turn on Apple Intelligence in System Settings to use this.';
  if (msg.includes('deviceNotEligible')) return "This device doesn't support Apple Intelligence.";
  if (msg.includes('modelNotReady'))
    return 'Apple Intelligence is still getting ready. Try again in a few minutes.';
  if (msg.includes('unsupportedOS'))
    return 'Needs macOS 26 or iOS 26 on a device with Apple Intelligence.';
  if (msg.includes('cancelled')) return 'Cancelled.';
  if (/exceededContextWindowSize/i.test(msg))
    return "That's too long for the on-device model. Try something shorter.";
  if (/guardrailViolation/i.test(msg)) return 'The on-device model declined that request.';
  return `Something went wrong: ${msg}`;
}
