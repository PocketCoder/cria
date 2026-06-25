# iOS features — swipe actions, pull-to-refresh, haptics

## 1. Haptics (@tauri-apps/plugin-haptics)

### Rust
- `Cargo.toml`: add `tauri-plugin-haptics = "2"` to cross-platform deps
- `lib.rs`: register `tauri_plugin_haptics::init()` in the cross-platform plugin block
- `capabilities/default.json`: add `"haptics:default"`

### JS
- `package.json`: add `@tauri-apps/plugin-haptics`
- New `src/utils/haptics.ts` — lazy-import wrapper, no-ops on desktop:
  - `impactCompletion()` — `impact({ style: 'medium' })`
  - `impactReordered()` — `impact({ style: 'light' })`
  - `impactDeleted()` — `notification({ type: 'warning' })`

### Call sites
- `TaskRow.handleToggle` + `SmartTaskRow.handleToggle` → `impactCompletion()`
- `TaskList.handleDragEnd` → `impactReordered()`
- Swipe-delete → `impactDeleted()`

---

## 2. Swipe actions — `useSwipeGesture` hook

### New `src/lib/useSwipeGesture.ts`

Tracks horizontal touch, reveals action buttons, triggers callbacks.

```
useSwipeGesture<T>({ onComplete, onDelete, disabled }):
  { ref, swipeState: { translateX, action, isSwiping }, resetSwipe }
```

- `touchstart`: record startX, startY, timestamp
- `touchmove`: if |dx| > |dy| × 1.5 → horizontal swipe. Clamp translateX to [-160, 0]. Thresholds: -80px complete, -160px delete
- `touchend`: if translateX < -80 → onComplete(). If < -160 → onDelete(). Animate back to 0 otherwise.
- Prevents dnd-kit conflict: exposes `isSwiping` that disables `useSortable`

### Row structure
```html
<li style="overflow:hidden; position:relative; touch-action:pan-y">
  <!-- Action buttons behind (absolute, right-aligned) -->
  <div class="absolute inset-0 flex justify-end">
    <button class="bg-green-500">✓ Complete</button>
    <button class="bg-red-500">✕ Delete</button>
  </div>
  <!-- Swipeable foreground -->
  <div ref={swipeRef} style="transform:translateX(${dx}px)">
    ...existing row content + dnd-kit listeners...
  </div>
</li>
```

### TaskRow changes
- Import `useSwipeGesture`
- Pass `isSwiping` to `useSortable({ disabled: ... || isSwiping })`
- Restructure `<li>` to swipeable layout
- `onComplete` → `handleToggle`
- `onDelete` → `enqueueDelete`

### SmartTaskRow changes
- Same hook, no dnd-kit conflict
- Track swipe state to prevent `onClick → setSelectedTask` after swipe
- Same complete/delete callbacks

---

## 3. Pull-to-refresh

### New `src/components/PullToRefresh.tsx`

```tsx
<PullToRefresh onRefresh={() => qc.invalidateQueries()}>
  {children}
</PullToRefresh>
```

- Container with `overflow:hidden` (viewport)
- Inner scrollable wrapper with `overflow-y:auto`
- Spinner indicator above content (outside viewport initially)
- Touch down at `scrollTop <= 0` → pull down → reveal spinner
- Pull past 60px → "Release to refresh" state
- Release → call `onRefresh()`, show spinner until refresh promise resolves
- Spinner: lucide `RefreshCw` with `animate-spin`, "Pull to refresh" / "Release to refresh" / "Refreshing…" label

### Mount points
- `TaskList.tsx`: wrap `<ul>` in PullToRefresh
- `SmartViews.tsx`: wrap scrollable `<section>` in PullToRefresh
- `SearchView.tsx`: wrap scrollable area in PullToRefresh
- Gated on `useIsMobile()` (`(max-width: 768px)`)

---

## Files changed

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-haptics = "2"` |
| `src-tauri/src/lib.rs` | Register `tauri_plugin_haptics::init()` |
| `src-tauri/capabilities/default.json` | Add `"haptics:default"` |
| `package.json` | Add `@tauri-apps/plugin-haptics` |
| `src/utils/haptics.ts` | **New** — haptics wrapper |
| `src/lib/useSwipeGesture.ts` | **New** — swipe gesture hook |
| `src/components/PullToRefresh.tsx` | **New** — pull-to-refresh wrapper |
| `src/features/tasks/TaskList.tsx` | Swipe + PullToRefresh + haptics |
| `src/features/smart-views/SmartViews.tsx` | Swipe + PullToRefresh + haptics |
| `src/features/search/SearchView.tsx` | PullToRefresh |
