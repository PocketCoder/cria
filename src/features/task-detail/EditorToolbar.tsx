import type { Editor } from '@tiptap/react';
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
  ListChecks,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Image,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export function Toolbar({
  editor,
  onImagePick,
  imagePickEnabled = true,
  imageUploading = false,
}: {
  editor: Editor;
  onImagePick?: () => void;
  /** False while the task hasn't yet got a server id — the image button
   * is dimmed and inert because there's nothing to upload against. */
  imagePickEnabled?: boolean;
  /** True while an upload is in flight — image button shows a spinner. */
  imageUploading?: boolean;
}) {
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
      className="max-w-full flex flex-wrap items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-1"
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
      {btn(
        'Task list',
        <ListChecks className="h-3.5 w-3.5" />,
        editor.isActive('taskList'),
        () => editor.chain().focus().toggleTaskList().run()
      )}
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      {btn(
        'Horizontal rule',
        <Minus className="h-3.5 w-3.5" />,
        false,
        () => editor.chain().focus().setHorizontalRule().run()
      )}
      <button
        type="button"
        key="Image"
        title={
          imagePickEnabled
            ? 'Image'
            : 'Save the task first — images upload as attachments and need a server id'
        }
        aria-label="Image"
        disabled={!imagePickEnabled || imageUploading}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onImagePick?.()}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-muted-foreground)]',
        )}
      >
        {imageUploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Image className="h-3.5 w-3.5" />
        )}
      </button>
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
