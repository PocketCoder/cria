import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useEffect, useState } from 'react';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
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
          className="prose prose-sm max-w-none text-sm leading-relaxed [&_a]:cursor-pointer [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic"
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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We open links via the opener plugin; TipTap's default link
        // extension is replaced below so we control its behaviour.
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
    ],
    content: initial || '<p></p>',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[6rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic',
      },
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

  return (
    <div className="space-y-2">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="flex items-center justify-end gap-2 text-[10px] text-[var(--color-muted-foreground)]">
        <span className="mr-auto">⌘+Enter to save · Esc to cancel</span>
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
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (
    label: string,
    icon: React.ReactNode,
    isActive: boolean,
    onClick: () => void,
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
        isActive && 'bg-[var(--color-muted)] text-[var(--color-foreground)]',
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
        () => editor.chain().focus().toggleBold().run(),
      )}
      {btn(
        'Italic',
        <Italic className="h-3.5 w-3.5" />,
        editor.isActive('italic'),
        () => editor.chain().focus().toggleItalic().run(),
      )}
      {btn(
        'Strikethrough',
        <Strikethrough className="h-3.5 w-3.5" />,
        editor.isActive('strike'),
        () => editor.chain().focus().toggleStrike().run(),
      )}
      {btn(
        'Inline code',
        <Code className="h-3.5 w-3.5" />,
        editor.isActive('code'),
        () => editor.chain().focus().toggleCode().run(),
      )}
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      {btn(
        'Heading 1',
        <Heading1 className="h-3.5 w-3.5" />,
        editor.isActive('heading', { level: 1 }),
        () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      )}
      {btn(
        'Heading 2',
        <Heading2 className="h-3.5 w-3.5" />,
        editor.isActive('heading', { level: 2 }),
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {btn(
        'Heading 3',
        <Heading3 className="h-3.5 w-3.5" />,
        editor.isActive('heading', { level: 3 }),
        () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      )}
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      {btn(
        'Bulleted list',
        <List className="h-3.5 w-3.5" />,
        editor.isActive('bulletList'),
        () => editor.chain().focus().toggleBulletList().run(),
      )}
      {btn(
        'Numbered list',
        <ListOrdered className="h-3.5 w-3.5" />,
        editor.isActive('orderedList'),
        () => editor.chain().focus().toggleOrderedList().run(),
      )}
      {btn(
        'Quote',
        <Quote className="h-3.5 w-3.5" />,
        editor.isActive('blockquote'),
        () => editor.chain().focus().toggleBlockquote().run(),
      )}
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      {btn(
        'Link',
        <LinkIcon className="h-3.5 w-3.5" />,
        editor.isActive('link'),
        promptLink,
      )}
    </div>
  );
}
