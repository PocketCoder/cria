import { useState, useEffect, useRef, useMemo } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import UnderlineExtension from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Terminal,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Link as LinkIcon,
  X,
  Trash2,
  ChevronDown,
  Check,
  Undo2,
  Redo2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { updateProject, deleteProject } from '@/db/projects';
import { useSelectableProjects } from '@/queries/projects';
import type { Project } from '@/domain/project';

/* ──────────────────────── props ──────────────────────── */

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
}

/* ──────────────────── slash command defs ─────────────── */

const COMMANDS = [
  { key: 'h1', label: 'Heading 1', description: 'Big section heading', icon: <Heading1 className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { key: 'h2', label: 'Heading 2', description: 'Medium section heading', icon: <Heading2 className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: 'h3', label: 'Heading 3', description: 'Small section heading', icon: <Heading3 className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { key: 'bold', label: 'Bold', description: 'Make text bold', icon: <Bold className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleBold().run() },
  { key: 'italic', label: 'Italic', description: 'Make text italic', icon: <Italic className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { key: 'strike', label: 'Strikethrough', description: 'Cross out text', icon: <Strikethrough className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { key: 'bullet', label: 'Bulleted list', description: 'Create a bulleted list', icon: <List className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { key: 'number', label: 'Numbered list', description: 'Create a numbered list', icon: <ListOrdered className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { key: 'quote', label: 'Quote', description: 'Capture a quote or highlight', icon: <Quote className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { key: 'codeblock', label: 'Code block', description: 'Write a block of code', icon: <Terminal className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
  { key: 'tasklist', label: 'Task list', description: 'Track tasks with a to-do list', icon: <ListChecks className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { key: 'hr', label: 'Horizontal rule', description: 'Divide a section', icon: <Minus className="h-4 w-4" />, action: (e: Editor) => e.chain().focus().setHorizontalRule().run() },
];

/* ───────────────────── main component ────────────────── */

export function ProjectSettingsModal({ project, onClose }: ProjectSettingsModalProps) {
  const { data: projects = [] } = useSelectableProjects();
  const [title, setTitle] = useState(project.title);
  const [identifier, setIdentifier] = useState(project.identifier ?? '');
  const [parentLocalId, setParentLocalId] = useState<string | null>(project.parentLocalId);
  const [descriptionHtml, setDescriptionHtml] = useState(project.description ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [parentSearch, setParentSearch] = useState('');
  const [parentOpen, setParentOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!parentOpen) return;
    const handler = (e: MouseEvent) => {
      if (parentRef.current && !parentRef.current.contains(e.target as Node)) {
        setParentOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [parentOpen]);

  // Filter available parents (exclude self and children of self — simple exclusion)
  const eligibleParents = useMemo(() => {
    return projects.filter((p) => p.localId !== project.localId);
  }, [projects, project.localId]);

  const filteredParents = useMemo(() => {
    if (!parentSearch.trim()) return eligibleParents;
    const q = parentSearch.toLowerCase();
    return eligibleParents.filter((p) => p.title.toLowerCase().includes(q));
  }, [eligibleParents, parentSearch]);

  const selectedParent = parentLocalId ? projects.find((p) => p.localId === parentLocalId) : null;

  // Validation
  const titleValid = title.trim().length > 0;
  const canSave = titleValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await updateProject(project.localId, {
        title: title.trim(),
        identifier: identifier.trim() || null,
        description: descriptionHtml || null,
        parentLocalId,
      });
      onClose();
    } catch (err) {
      console.error('[ProjectSettings] save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.localId);
      onClose();
    } catch (err) {
      console.error('[ProjectSettings] delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Cmd+Enter to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="glass-surface flex max-h-[85vh] w-11/12 max-w-xl flex-col overflow-hidden rounded-lg shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-sm font-semibold">Edit This Project</h2>
          <button onClick={onClose} className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={project.title}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
              />
            </div>

            {/* Parent Project */}
            <div className="space-y-1.5" ref={parentRef}>
              <label className="text-sm font-semibold">Parent Project</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setParentOpen(!parentOpen)}
                  className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-left text-[var(--color-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                >
                  <span className={selectedParent ? '' : 'text-[var(--color-muted-foreground)]'}>
                    {selectedParent ? selectedParent.title : 'None (top-level project)'}
                  </span>
                  <ChevronDown className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                </button>
                {parentOpen && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-lg">
                    <input
                      type="text"
                      value={parentSearch}
                      onChange={(e) => setParentSearch(e.target.value)}
                      placeholder="Type to search for a project..."
                      autoFocus
                      className="sticky top-0 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm mb-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                    />
                    <button
                      type="button"
                      onClick={() => { setParentLocalId(null); setParentOpen(false); setParentSearch(''); }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-[var(--color-muted)]',
                        !parentLocalId && 'bg-[var(--color-muted)] font-medium',
                      )}
                    >
                      <span className="flex-1">None (top-level project)</span>
                      {!parentLocalId && <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />}
                    </button>
                    {filteredParents.map((p) => (
                      <button
                        key={p.localId}
                        type="button"
                        onClick={() => { setParentLocalId(p.localId); setParentOpen(false); setParentSearch(''); }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-[var(--color-muted)]',
                          parentLocalId === p.localId && 'bg-[var(--color-muted)] font-medium',
                        )}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.hexColor || 'var(--color-muted-foreground)' }} />
                        <span className="flex-1 truncate">{p.title}</span>
                        {parentLocalId === p.localId && <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />}
                      </button>
                    ))}
                    {filteredParents.length === 0 && (
                      <p className="px-2 py-2 text-xs text-[var(--color-muted-foreground)]">No matching projects</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Project Identifier */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Project Identifier</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="The project identifier goes here..."
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
              />
            </div>

            {/* Description Editor */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Description</label>
              <ProjectDescriptionEditor
                value={descriptionHtml}
                onChange={setDescriptionHtml}
              />
            </div>

          </div>
        </div>

        {/* ── Footer ── */}
        <footer className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-3">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-muted-foreground)]">Delete "{project.title}"?</span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="rounded-md bg-[var(--color-destructive)] px-2 py-1 text-xs font-medium text-[var(--color-destructive-foreground)] hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1 text-xs text-[var(--color-destructive)] hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ──────────────── project description editor ─────────── */

function ProjectDescriptionEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const slashRef = useRef({
    open: false,
    query: '',
    coords: { top: 0, left: 0 },
    selectedIndex: 0,
    filteredCount: 0,
  });
  const [slashUI, setSlashUI] = useState({ open: false, query: '', coords: { top: 0, left: 0 }, selectedIndex: 0 });

  const updateSlash = (updates: Partial<typeof slashUI> & { filteredCount?: number }) => {
    Object.assign(slashRef.current, updates);
    setSlashUI({ open: slashRef.current.open, query: slashRef.current.query, coords: slashRef.current.coords, selectedIndex: slashRef.current.selectedIndex });
  };

  const checkSlash = (editor: Editor) => {
    const { selection } = editor.state;
    const { $from } = selection;
    if (!$from.parent.isTextblock) { updateSlash({ open: false }); return; }
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, null, '\0');
    const match = textBefore.match(/(?:^|\s)\/(\w*)$/);
    if (match) {
      const query = match[1] ?? '';
      const coords = editor.view.coordsAtPos(selection.from);
      updateSlash({ open: true, query, coords: { top: coords.bottom, left: coords.left }, selectedIndex: 0, filteredCount: COMMANDS.filter((c) => c.key.includes(query.toLowerCase()) || c.label.toLowerCase().includes(query.toLowerCase())).length });
    } else {
      updateSlash({ open: false });
    }
  };

  const execSlash = (index: number, editor: Editor) => {
    const query = slashRef.current.query;
    const start = editor.state.selection.from - (query.length + 1);
    const filtered = COMMANDS.filter((c) => c.key.includes(query.toLowerCase()) || c.label.toLowerCase().includes(query.toLowerCase()));
    const cmd = filtered[index];
    if (cmd) {
      editor.chain().focus().deleteRange({ from: start, to: editor.state.selection.from }).run();
      cmd.action(editor);
    }
    updateSlash({ open: false });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      UnderlineExtension,
      LinkExtension.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      TaskList.configure({ HTMLAttributes: { class: 'not-prose pl-0 space-y-1' } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { class: 'flex items-start gap-2' } }),
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[8rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm leading-relaxed break-words focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-center [&_ul[data-type=taskList]_li]:gap-1.5 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md',
      },
      handleKeyDown(view, event) {
        const s = slashRef.current;
        if (s.open && s.filteredCount > 0) {
          if (event.key === 'ArrowDown') { event.preventDefault(); updateSlash({ selectedIndex: (s.selectedIndex + 1) % s.filteredCount }); return true; }
          if (event.key === 'ArrowUp') { event.preventDefault(); updateSlash({ selectedIndex: (s.selectedIndex - 1 + s.filteredCount) % s.filteredCount }); return true; }
          if (event.key === 'Enter') { event.preventDefault(); const ed = (view as any).editor || editor; if (ed) execSlash(s.selectedIndex, ed); return true; }
          if (event.key === 'Escape') { event.preventDefault(); updateSlash({ open: false }); return true; }
        }
        return false;
      },
    },
    onUpdate({ editor: ed }) {
      checkSlash(ed);
      const html = ed.getHTML();
      const text = html.replace(/<[^>]*>/g, '').trim();
      const hasMedia = /<(img|hr|input)\b/i.test(html);
      onChange(text === '' && !hasMedia ? '' : html);
    },
    onSelectionUpdate({ editor: ed }) { checkSlash(ed); },
  });

  if (!editor) return null;

  const promptLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const queryLower = slashUI.query.toLowerCase();
  const filtered = COMMANDS.filter((c) => c.key.includes(queryLower) || c.label.toLowerCase().includes(queryLower));

  const isLowerHalf = slashUI.coords.top > window.innerHeight / 2;
  const popTop = isLowerHalf ? slashUI.coords.top - 248 : slashUI.coords.top + 8;

  const tb = (label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void) => (
    <button type="button" key={label} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cn('flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]', isActive && 'bg-[var(--color-muted)] text-[var(--color-foreground)]')}>
      {icon}
    </button>
  );

  return (
    <div className="relative space-y-2">
      <div role="toolbar" className="flex flex-wrap items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-1">
        {tb('Bold', <Bold className="h-3.5 w-3.5" />, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
        {tb('Italic', <Italic className="h-3.5 w-3.5" />, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
        {tb('Underline', <UnderlineIcon className="h-3.5 w-3.5" />, editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}
        {tb('Strikethrough', <Strikethrough className="h-3.5 w-3.5" />, editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run())}
        {tb('Inline code', <Code className="h-3.5 w-3.5" />, editor.isActive('code'), () => editor.chain().focus().toggleCode().run())}
        {tb('Code block', <Terminal className="h-3.5 w-3.5" />, editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run())}
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
        {tb('Heading 1', <Heading1 className="h-3.5 w-3.5" />, editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run())}
        {tb('Heading 2', <Heading2 className="h-3.5 w-3.5" />, editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {tb('Heading 3', <Heading3 className="h-3.5 w-3.5" />, editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
        {tb('Bulleted list', <List className="h-3.5 w-3.5" />, editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
        {tb('Numbered list', <ListOrdered className="h-3.5 w-3.5" />, editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
        {tb('Blockquote', <Quote className="h-3.5 w-3.5" />, editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run())}
        {tb('Task list', <ListChecks className="h-3.5 w-3.5" />, editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run())}
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
        {tb('Horizontal rule', <Minus className="h-3.5 w-3.5" />, false, () => editor.chain().focus().setHorizontalRule().run())}
        {tb('Link', <LinkIcon className="h-3.5 w-3.5" />, editor.isActive('link'), promptLink)}
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
        {tb('Undo', <Undo2 className="h-3.5 w-3.5" />, false, () => editor.chain().focus().undo().run())}
        {tb('Redo', <Redo2 className="h-3.5 w-3.5" />, false, () => editor.chain().focus().redo().run())}
      </div>

      <EditorContent editor={editor} />

      {slashUI.open && filtered.length > 0 && (
        <div
          role="menu"
          className="fixed z-50 flex max-h-[220px] w-56 flex-col overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-lg ring-1 ring-black/5 backdrop-blur-md"
          style={{ top: `${popTop}px`, left: `${slashUI.coords.left}px` }}
        >
          {filtered.map((cmd, idx) => {
            const sel = idx === slashUI.selectedIndex;
            return (
              <button key={cmd.key} type="button" role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => execSlash(idx, editor)}
                onMouseEnter={() => updateSlash({ selectedIndex: idx })}
                className={cn('flex w-full items-center gap-3 rounded px-2.5 py-1.5 text-left transition-colors duration-75', sel ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]')}
              >
                <span className={cn('shrink-0', sel ? 'text-current' : 'text-[var(--color-muted-foreground)]')}>{cmd.icon}</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium leading-none">{cmd.label}</span>
                  <span className={cn('mt-0.5 text-micro leading-tight truncate', sel ? 'text-[var(--color-primary-foreground)]/80' : 'text-[var(--color-muted-foreground)]')}>{cmd.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-footnote text-[var(--color-muted-foreground)]">Tip: Type / for formatting options</p>
    </div>
  );
}
