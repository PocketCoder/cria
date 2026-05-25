import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TiptapUnderline from '@tiptap/extension-underline';
import { useEffect, useState, useRef } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Terminal,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Heading1,
  Heading2,
  Heading3,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { sanitizeHtml } from '@/lib/sanitize';
import { onLinkClickOpenExternal } from '@/lib/openExternal';

interface RichTextEditorProps {
  value: string | null;
  onSave: (next: string) => Promise<void>;
}

const COMMANDS = [
  {
    key: 'h1',
    label: 'Heading 1',
    description: 'Big section heading',
    icon: <Heading1 className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    key: 'h2',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: <Heading2 className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'h3',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: <Heading3 className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    key: 'bullet',
    label: 'Bulleted list',
    description: 'Create a simple bulleted list',
    icon: <List className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'number',
    label: 'Numbered list',
    description: 'Create a list with numbering',
    icon: <ListOrdered className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    key: 'quote',
    label: 'Quote',
    description: 'Capture a quote or highlight',
    icon: <Quote className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    key: 'codeblock',
    label: 'Code block',
    description: 'Write a block of code',
    icon: <Terminal className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: 'bold',
    label: 'Bold',
    description: 'Make text bold',
    icon: <Bold className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    label: 'Italic',
    description: 'Make text italic',
    icon: <Italic className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    key: 'underline',
    label: 'Underline',
    description: 'Underline text',
    icon: <Underline className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    key: 'strike',
    label: 'Strikethrough',
    description: 'Cross out text',
    icon: <Strikethrough className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleStrike().run(),
  },
];

/**
 * TipTap-based WYSIWYG editor for task descriptions. Two display modes:
 *
 * - **Read mode** (default): renders sanitised HTML, with anchor clicks
 *   routed through the OS default browser via openExternal. A hover-
 *   revealed "Edit" link enters edit mode.
 * - **Edit mode**: full TipTap editor with a fixed toolbar. Save / Cancel
 *   commit or discard. On save, output is run through DOMPurify so
 *   nothing untrusted reaches the server.
 *
 * Matches what Vikunja's web client emits (it also uses TipTap), so
 * round-tripping a description between Cria and the web UI doesn't lose
 * formatting.
 */
export function RichTextEditor({ value, onSave }: RichTextEditorProps) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return <ReadView value={value} onEdit={() => setEditing(true)} />;
  }
  return (
    <EditView
      initial={value ?? ''}
      onCancel={() => setEditing(false)}
      onSave={async (html) => {
        await onSave(sanitizeHtml(html));
        setEditing(false);
      }}
    />
  );
}

function ReadView({
  value,
  onEdit,
}: {
  value: string | null;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:underline"
        >
          Edit
        </button>
      </div>
      {value ? (
        <div
          className="prose prose-sm max-w-none break-words text-sm leading-relaxed [&_a]:cursor-pointer [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
          onClick={onLinkClickOpenExternal}
        />
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="w-full rounded-md border border-dashed border-[var(--color-border)] p-3 text-left text-sm italic text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
        >
          Add a description…
        </button>
      )}
    </div>
  );
}

function EditView({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (html: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  // Slash Command Menu State managed via Ref to avoid stale closures in TipTap callbacks,
  // and synced to UI state for React rendering.
  const slashStateRef = useRef({
    open: false,
    query: '',
    coords: { top: 0, left: 0 },
    selectedIndex: 0,
    filteredCommandsCount: 0,
  });

  const [slashUI, setSlashUI] = useState({
    open: false,
    query: '',
    coords: { top: 0, left: 0 },
    selectedIndex: 0,
  });

  const updateSlashState = (updates: Partial<typeof slashUI> & { filteredCommandsCount?: number }) => {
    slashStateRef.current = {
      ...slashStateRef.current,
      ...updates,
    };
    setSlashUI({
      open: slashStateRef.current.open,
      query: slashStateRef.current.query,
      coords: slashStateRef.current.coords,
      selectedIndex: slashStateRef.current.selectedIndex,
    });
  };

  const checkSlash = (editorInstance: Editor) => {
    const { selection } = editorInstance.state;
    const { $from } = selection;

    if (!$from.parent.isTextblock) {
      updateSlashState({ open: false });
      return;
    }

    const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, null, '\0');
    // Matches a slash command at the start of block or after whitespace, followed by optional letters/digits.
    const match = textBeforeCursor.match(/(?:^|\s)\/(\w*)$/);

    if (match) {
      const query = match[1] ?? '';
      const view = editorInstance.view;

      try {
        const coords = view.coordsAtPos(selection.from);
        const queryLower = query.toLowerCase();
        const filtered = COMMANDS.filter(
          (cmd) =>
            cmd.key.toLowerCase().includes(queryLower) ||
            cmd.label.toLowerCase().includes(queryLower)
        );

        updateSlashState({
          open: true,
          query,
          coords: { top: coords.bottom, left: coords.left },
          selectedIndex: 0,
          filteredCommandsCount: filtered.length,
        });
      } catch (err) {
        updateSlashState({ open: false });
      }
    } else {
      updateSlashState({ open: false });
    }
  };

  const executeSlashCommand = (index: number, editorInstance: Editor) => {
    const query = slashStateRef.current.query;
    const { selection } = editorInstance.state;
    const start = selection.from - (query.length + 1);

    const queryLower = query.toLowerCase();
    const filtered = COMMANDS.filter(
      (cmd) =>
        cmd.key.toLowerCase().includes(queryLower) ||
        cmd.label.toLowerCase().includes(queryLower)
    );

    const cmd = filtered[index];
    if (cmd) {
      editorInstance
        .chain()
        .focus()
        .deleteRange({ from: start, to: selection.from })
        .run();

      cmd.action(editorInstance);
    }
    updateSlashState({ open: false });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      TiptapUnderline,
    ],
    content: initial || '<p></p>',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[6rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm leading-relaxed break-words focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline',
      },
      handleKeyDown(view, event) {
        if (slashStateRef.current.open) {
          const count = slashStateRef.current.filteredCommandsCount;
          if (count > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              const nextIndex = (slashStateRef.current.selectedIndex + 1) % count;
              updateSlashState({ selectedIndex: nextIndex });
              return true;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              const prevIndex = (slashStateRef.current.selectedIndex - 1 + count) % count;
              updateSlashState({ selectedIndex: prevIndex });
              return true;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const editorInstance = (view as any).editor || editor;
              if (editorInstance) {
                executeSlashCommand(slashStateRef.current.selectedIndex, editorInstance);
              }
              return true;
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            updateSlashState({ open: false });
            return true;
          }
        }
        return false;
      },
    },
    onUpdate({ editor: editorInstance }) {
      checkSlash(editorInstance);
    },
    onSelectionUpdate({ editor: editorInstance }) {
      checkSlash(editorInstance);
    },
  });

  const handleSave = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      await onSave(editor.getHTML());
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+Enter to save while editor has focus.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    dom.addEventListener('keydown', handler);
    return () => dom.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  // Filter commands for the slash command popup UI
  const queryLower = slashUI.query.toLowerCase();
  const filteredCommands = COMMANDS.filter(
    (cmd) =>
      cmd.key.toLowerCase().includes(queryLower) ||
      cmd.label.toLowerCase().includes(queryLower)
  );

  // Position slash menu dynamically to avoid running off viewport bottom
  const isLowerHalf = slashUI.coords.top > window.innerHeight / 2;
  const popupTop = isLowerHalf ? slashUI.coords.top - 248 : slashUI.coords.top + 8;

  return (
    <div className="relative space-y-2">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="flex items-center justify-end gap-2 text-[10px] text-[var(--color-muted-foreground)]">
        <span className="mr-auto">⌘+Enter to save · Esc to cancel · Type / for commands</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {slashUI.open && filteredCommands.length > 0 && (
        <div
          role="menu"
          className="fixed z-50 flex max-h-[220px] w-56 flex-col overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-lg ring-1 ring-black/5 focus:outline-none backdrop-blur-md"
          style={{
            top: `${popupTop}px`,
            left: `${slashUI.coords.left}px`,
          }}
        >
          {filteredCommands.map((cmd, idx) => {
            const isSelected = idx === slashUI.selectedIndex;
            return (
              <button
                key={cmd.key}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()} // Prevents stealing editor focus
                onClick={() => executeSlashCommand(idx, editor)}
                onMouseEnter={() => updateSlashState({ selectedIndex: idx })}
                className={cn(
                  'flex w-full items-center gap-3 rounded px-2.5 py-1.5 text-left transition-colors duration-75',
                  isSelected
                    ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]'
                )}
              >
                <span
                  className={cn(
                    'shrink-0',
                    isSelected ? 'text-current' : 'text-[var(--color-muted-foreground)]'
                  )}
                >
                  {cmd.icon}
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium leading-none">{cmd.label}</span>
                  <span
                    className={cn(
                      'mt-0.5 text-[9px] leading-tight truncate',
                      isSelected
                        ? 'text-[var(--color-primary-foreground)]/80'
                        : 'text-[var(--color-muted-foreground)]'
                    )}
                  >
                    {cmd.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (
    label: string,
    icon: React.ReactNode,
    isActive: boolean,
    onClick: () => void
  ) => (
    <button
      type="button"
      key={label}
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]',
        isActive && 'bg-[var(--color-muted)] text-[var(--color-foreground)]'
      )}
    >
      {icon}
    </button>
  );

  const promptLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div
      role="toolbar"
      className="flex flex-wrap items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-1"
    >
      {btn(
        'Bold',
        <Bold className="h-3.5 w-3.5" />,
        editor.isActive('bold'),
        () => editor.chain().focus().toggleBold().run()
      )}
      {btn(
        'Italic',
        <Italic className="h-3.5 w-3.5" />,
        editor.isActive('italic'),
        () => editor.chain().focus().toggleItalic().run()
      )}
      {btn(
        'Underline',
        <Underline className="h-3.5 w-3.5" />,
        editor.isActive('underline'),
        () => editor.chain().focus().toggleUnderline().run()
      )}
      {btn(
        'Strikethrough',
        <Strikethrough className="h-3.5 w-3.5" />,
        editor.isActive('strike'),
        () => editor.chain().focus().toggleStrike().run()
      )}
      {btn(
        'Inline code',
        <Code className="h-3.5 w-3.5" />,
        editor.isActive('code'),
        () => editor.chain().focus().toggleCode().run()
      )}
      {btn(
        'Code block',
        <Terminal className="h-3.5 w-3.5" />,
        editor.isActive('codeBlock'),
        () => editor.chain().focus().toggleCodeBlock().run()
      )}
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      {btn(
        'Heading 1',
        <Heading1 className="h-3.5 w-3.5" />,
        editor.isActive('heading', { level: 1 }),
        () => editor.chain().focus().toggleHeading({ level: 1 }).run()
      )}
      {btn(
        'Heading 2',
        <Heading2 className="h-3.5 w-3.5" />,
        editor.isActive('heading', { level: 2 }),
        () => editor.chain().focus().toggleHeading({ level: 2 }).run()
      )}
      {btn(
        'Heading 3',
        <Heading3 className="h-3.5 w-3.5" />,
        editor.isActive('heading', { level: 3 }),
        () => editor.chain().focus().toggleHeading({ level: 3 }).run()
      )}
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      {btn(
        'Bulleted list',
        <List className="h-3.5 w-3.5" />,
        editor.isActive('bulletList'),
        () => editor.chain().focus().toggleBulletList().run()
      )}
      {btn(
        'Numbered list',
        <ListOrdered className="h-3.5 w-3.5" />,
        editor.isActive('orderedList'),
        () => editor.chain().focus().toggleOrderedList().run()
      )}
      {btn(
        'Quote',
        <Quote className="h-3.5 w-3.5" />,
        editor.isActive('blockquote'),
        () => editor.chain().focus().toggleBlockquote().run()
      )}
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      {btn(
        'Link',
        <LinkIcon className="h-3.5 w-3.5" />,
        editor.isActive('link'),
        promptLink
      )}
    </div>
  );
}
