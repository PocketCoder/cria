# Project Views — Remaining Work (resume plan)

Scratch/resume doc. **Not committed.** Implementation plan for the three
remaining items after PR #82.

## Where things stand
- `dev` == `main` == `c5cca6a` (sync-resilience shipped).
- **PR #82** (`feat/project-views`) has: foundation + ViewSwitcher, Kanban
  (CRUD, drag-between-buckets, add-task, optimistic move, bucket
  done/default/limit, **filter popup**), Table (sortable, columns,
  created/createdBy, table-wide edit mode, labels), Gantt (timeline, bars,
  drag/resize, tree, collapse, date filters, relation arrows, keyboard
  nudge), plus the sync-resilience merge.
- Workflow per task: branch off `feat/project-views` → implement → `tsc`
  + `pnpm test` → GUI test → on approval `--ff-only` merge back into
  `feat/project-views` (updates PR #82) → delete temp branch.
- Filed, not doing now: **#1** Kanban pagination → issue **#85**;
  **#7** commentCount (needs comment sync) → issue **#83**; **#8** List
  DnD/keyboard → dropped (M9 scope).

---

## #3 — Drag-reorder buckets + cards, with persisted `position`
**Biggest item. Also lays the groundwork for ordering in List/Table later.**

### Model
- **Buckets** already have `position REAL` (migration 011) and the bucket
  push body already sends `position` (`bucketBody` in `src/sync/push.ts`).
  Reordering columns = recompute bucket `position` + `updateBucket`.
- **Cards** have *no* per-view order yet. `task_buckets` is
  `(task_local_id, view_local_id, bucket_local_id)` — no position.
  → **New migration `012_task_bucket_position.sql`**: add
  `position REAL NOT NULL DEFAULT 0` to `task_buckets`. Register it in
  `src-tauri/src/lib.rs` (MIGRATION_12) **and** `tests/unit/_helpers.ts`.
- Vikunja orders cards by a per-view `position` and persists via
  **`POST /tasks/{id}/position`** (body `{ project_view_id, position }`) —
  confirmed present in `src/api/schema.ts:5791`. Bucket membership moves via
  the existing `POST .../buckets/{bucket}/tasks`.

### Fractional indexing (reusable)
- New file **`src/lib/position.ts`**: pure
  `calculatePosition(before: number | null, after: number | null): number`
  — midpoint of neighbors (`before+after)/2`), `after/2` at the top,
  `before+1` (or `+2^k`) at the bottom, `0`→`65536`-style seed when empty.
  Port Vikunja's `calculateItemPosition` (`frontend/src/helpers/calculateItemPosition.ts`).
  Unit-test this; it's the foundation for List/Table ordering too.

### DB (`src/db/buckets.ts`)
- `setTaskBucket(task, view, bucket, position?)` — also write `position`.
- `reorderTaskInView(taskLocalId, viewLocalId, newPosition)` — update only
  position; outbox `task_position` op (new op kind) or reuse `task_bucket`
  with a position field.
- `reorderBucket(bucketLocalId, newPosition)` — `updateBucket` position
  (already supported + pushed).
- Outbox: add a `task_position` entity (or extend `task_bucket` payload with
  `position`) handled in `executeOp` → `POST /tasks/{id}/position`.

### Query (`src/queries/kanban.ts`)
- `buildKanbanColumns` must **sort each column's tasks by `position`** (read
  positions from `task_buckets`). `listBucketAssignmentsForView` returns
  `{taskLocalId, bucketLocalId, position}` — sort by it.

### UI (`src/features/kanban/KanbanBoard.tsx`)
- Reintroduce **sortable** for cards (we're on plain `useDraggable` now to
  fix a cross-bucket bug — see commit `513d1dc`). Use `@dnd-kit/sortable`
  (still a dep) with **`onDragOver` to move between containers** + an
  `onDragEnd` that computes target bucket **and index**, then writes bucket
  + `calculatePosition(neighbors)`. Keep the optimistic cache update.
  ⚠️ This is exactly the area that broke before — be deliberate: a
  multi-container sortable needs the drag-over handler to reparent, and the
  collision detection must distinguish "over a card" vs "over the column".
- **Column reorder**: wrap the column strip in a horizontal `SortableContext`
  (bucket ids); on end, `reorderBucket` with a fractional position between
  neighbors.

### Tests
- `position.test.ts` (calculatePosition: midpoint, ends, empty).
- `buildKanbanColumns` orders by position.
- reorder writes the expected position + queues the right op.

### Gotchas
- Don't regress the cross-bucket move (commit `513d1dc`, `5103553`,
  `7c18bf4`). Verify moves + reorder both persist and survive a poll.
- Verify the exact `/tasks/{id}/position` body shape in `schema.ts`.
- **Effort: large.**

---

## #5 — Custom view CRUD (project settings)
**Mostly UI — the data layer already exists.**

### Already done
- `createView` / `updateView` / `deleteView` in `src/db/views.ts`, and
  `executeViewOp` (create/update/delete) in `src/sync/push.ts`. New views are
  `dirty=1` → sync; the 4 seeded defaults are local-only (`dirty=0`).

### To build (UI)
- **`src/features/projects/ViewManagerModal.tsx`** (or a popover): list the
  project's views with **rename** (inline) + **delete**, and an **Add view**
  row (title + kind select: list/gantt/table/kanban). New view position =
  after the current max.
- Surface it from **`ProjectHeader.tsx`** — a small "manage views" affordance
  next to the `ViewSwitcher` (gear/▾). Vikunja puts this in project settings
  (`frontend/src/views/project/settings/ProjectSettingsViews.vue`); Cria has
  no settings page, so a header button + modal is simplest.
- Uses `useProjectViews(project.localId)` + the existing mutations.

### Gotchas
- Block deleting the **last** view (keep ≥1).
- Deleting a default (local-only, no server id) → `deleteView` soft-deletes +
  outbox delete; push just drops locally (no server id) — already handled.
- After create, `useProjectViews` refetches via `notify('views')`.

### Tests
- createView/updateView/deleteView mostly covered; add one for create→push
  body if needed. Modal UI not unit-tested.
- **Effort: medium.**

---

## #6 — Gantt arrows re-route around collapsed parents (cosmetic)
**Small. Optional.**

### Current
- `GanttRelationArrows` skips any edge whose endpoint isn't in `geometry`
  (i.e. hidden under a collapsed parent).

### Approach
- In `GanttChart`, build a **child→parent** map from the tree's `childIds`
  (and the project subtask map). Add `resolveVisibleAnchor(taskLocalId)`:
  if the task's row is hidden, walk up the parent chain to the first
  ancestor present in the visible set (the collapsed parent itself is
  visible) and return *its* geometry.
- Pass resolved anchors (or a resolver) to `GanttRelationArrows`. For each
  edge, anchor each endpoint to its visible ancestor; **skip** if both
  resolve to the same node; **dedupe** identical resolved pairs; optionally
  offset overlapping arrows (Vikunja's `spreadOverlappingArrows`).

### Files
- `src/features/gantt/GanttChart.tsx` (anchor map), `GanttRelationArrows.tsx`
  (consume resolved edges).

### Gotchas
- Purely visual; ensure no arrows when a whole subtree is collapsed onto its
  parent and the other endpoint is inside the same subtree.
- **Effort: small–medium.**

---

## Suggested order
1. **#5** (quick UI win, data layer ready) — or
2. **#3** (foundational; unblocks List/Table ordering) — bigger, do when you
   have a solid block of time; reuse `src/lib/position.ts` afterward.
3. **#6** last (cosmetic).
