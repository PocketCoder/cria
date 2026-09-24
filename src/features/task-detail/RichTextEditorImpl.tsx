import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { buildMentionExtension, type MentionSearch } from './mentionExtension';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { VikunjaImage, getAttachmentObjectUrl } from './tiptapImageExtension';
import { uploadAttachment } from '@/sync/attachments';
import { buildAttachmentUrl, isAttachmentUrl, parseAttachmentUrl } from '@/sync/attachments';
import { ImageLightbox } from './ImageLightbox';
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
  ListChecks,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Image,
  Pencil,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { sanitizeHtml } from '@/lib/sanitize';
import { onLinkClickOpenExternal } from '@/lib/openExternal';
import { isOfflineError } from '@/lib/errors';
import { InlineWarning } from '@/components/InlineWarning';

export interface RichTextEditorProps {
  value: string | null;
  onSave: (next: string) => Promise<void>;
  /** Local row id — required for the upload path to mirror new
   * attachments into the local DB so the AttachmentList refreshes
   * without waiting for the next pull. */
  taskLocalId: string;
  /** Server id — null for tasks that haven't yet synced. Inline image
   * uploads are disabled in that state (we have nothing to attach to);
   * a visual hint covers it. */
  taskServerId: number | null;
  /** If true, start in edit mode immediately instead of read mode.
   * Intended for create forms where there is no content to preview. */
  autoEdit?: boolean;
  /** When set, "@" opens a mention picker fed by this search (project
   * members). Mentions serialize to Vikunja's <mention-user> element. */
  mentionSearch?: MentionSearch;
}

let _triggerImagePicker: (() => void) | null = null;

export function setImagePickerTrigger(fn: (() => void) | null) {
  _triggerImagePicker = fn;
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
  {
    key: 'tasklist',
    label: 'Task list',
    description: 'Track tasks with a to-do list',
    icon: <ListChecks className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    key: 'hr',
    label: 'Horizontal rule',
    description: 'Divide a section',
    icon: <Minus className="h-4 w-4" />,
    action: (editor: Editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    key: 'image',
    label: 'Image',
    description: 'Upload an image from your computer',
    icon: <Image className="h-4 w-4" />,
    action: () => _triggerImagePicker?.(),
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
 *
 * Lazy-loaded via the thin `RichTextEditor` wrapper in
 * `./RichTextEditor` — that's what keeps the ~600 KB of ProseMirror /
 * TipTap code out of the startup bundle. Import the wrapper, not this.
 */
export function RichTextEditorImpl({
  value,
  onSave,
  taskLocalId,
  taskServerId,
  autoEdit,
  mentionSearch,
}: RichTextEditorProps) {
  const [editing, setEditing] = useState(autoEdit ?? false);

  if (!editing) {
    return (
      <ReadView
        value={value}
        onEdit={() => setEditing(true)}
        taskServerId={taskServerId}
        onSave={async (html) => {
          // ReadView re-uses the same sanitize-wrap rule as EditView so
          // task-list checkbox toggles round-trip through the server in
          // the same shape Vikunja-web would emit.
          await onSave(sanitizeHtml(html));
        }}
      />
    );
  }
  return (
    <EditView
      initial={value ?? ''}
      onCancel={() => setEditing(false)}
      onSave={async (html) => {
        await onSave(sanitizeHtml(html));
        setEditing(false);
      }}
      taskLocalId={taskLocalId}
      taskServerId={taskServerId}
      mentionSearch={mentionSearch}
    />
  );
}

function ReadView({
  value,
  onEdit,
  taskServerId,
  onSave,
}: {
  value: string | null;
  onEdit: () => void;
  taskServerId: number | null;
  /** Same shape as EditView's onSave. We need it here so checkbox
   * toggles in rendered task-lists persist without forcing the user
   * to enter edit mode. */
  onSave: (html: string) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{
    taskServerId: number;
    attachmentServerId: number;
    fileName: string;
  } | null>(null);

  /**
   * Container click dispatch for rendered descriptions.
   *
   * 1. **Task-list checkbox** → toggle + serialize + save in place.
   *    There's no TipTap editor in ReadView (the description is just
   *    sanitised HTML through dangerouslySetInnerHTML), so we have to
   *    mutate the DOM ourselves and call onSave directly. We
   *    preventDefault before the browser's own toggle runs so the
   *    attribute/property pair stays in sync — otherwise innerHTML
   *    serialisation reads the old attribute and the toggle reverts on
   *    the next refetch.
   * 2. **Inline image** → open the lightbox (same `<img>` walk as
   *    before).
   * 3. **Anchor** → route through `onLinkClickOpenExternal` to open
   *    in the OS browser.
   */
  const onContainerClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;

    if (
      target instanceof HTMLInputElement &&
      target.type === 'checkbox' &&
      target.closest('li[data-type="taskItem"]')
    ) {
      // By the time React's synthetic onClick fires, the browser has
      // already toggled `target.checked` (the property). What hasn't
      // synced is the `checked` *attribute* — and that's what
      // innerHTML serialisation reads. Mirror property → attribute so
      // the saved HTML reflects the new state, then update the LI's
      // data-checked so TipTap parses it back correctly on next pull.
      const newChecked = target.checked;
      if (newChecked) target.setAttribute('checked', 'checked');
      else target.removeAttribute('checked');
      const li = target.closest('li[data-type="taskItem"]') as HTMLElement;
      li.setAttribute('data-checked', String(newChecked));
      const html = containerRef.current?.innerHTML;
      if (html) void onSave(html);
      return;
    }

    const img = target.closest('img');
    if (img) {
      const dataSrc = img.getAttribute('data-src');
      const rawSrc = img.getAttribute('src');
      const realSrc = dataSrc ?? rawSrc ?? '';
      if (isAttachmentUrl(realSrc)) {
        const parsed = parseAttachmentUrl(realSrc);
        if (parsed) {
          e.preventDefault();
          e.stopPropagation();
          setPreview({
            taskServerId: parsed.taskServerId,
            attachmentServerId: parsed.attachmentServerId,
            fileName: img.getAttribute('alt') || 'image',
          });
          return;
        }
      }
    }
    onLinkClickOpenExternal(e);
  };

  // Auth-fetch any inline images that reference our server. The
  // sanitised HTML lands in the DOM as-is with either
  //   <img data-src="<server>/.../attachments/<id>" src="#">  (current)
  // or, for older / pre-VikunjaImage descriptions:
  //   <img src="<server>/.../attachments/<id>">
  // In the first case the browser does nothing (src is just '#'); in
  // the second the browser fires a no-auth fetch that 401s before we
  // can intercept, but we can still detect and replace. Either way
  // we end up with `img.src = <object-url>` after the auth fetch.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img'));
    let cancelled = false;
    for (const img of imgs) {
      const dataSrc = img.getAttribute('data-src');
      const rawSrc = img.getAttribute('src');
      const realSrc = dataSrc ?? rawSrc;
      if (!realSrc || !isAttachmentUrl(realSrc)) continue;
      const parsed = parseAttachmentUrl(realSrc);
      if (!parsed) continue;
      // Suppress the browser's pending no-auth fetch immediately —
      // this also clears the broken-image icon while we resolve.
      if (rawSrc !== '#') img.src = '#';
      void getAttachmentObjectUrl(parsed.taskServerId, parsed.attachmentServerId).then(
        (url) => {
          if (!cancelled) img.src = url;
        },
        (err) => console.warn('[ReadView] inline image fetch failed:', err),
      );
    }
    return () => {
      cancelled = true;
    };
    // Re-run when the description html or task changes.
  }, [value, taskServerId]);

  const editBtn = (
    <button
      type="button"
      onClick={onEdit}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-sm transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );

  if (!value || !value.replace(/<[^>]*>/g, '').trim()) {
    return (
      <div className="min-w-0 max-w-full space-y-2">
        <button
          type="button"
          onClick={onEdit}
          className="w-full rounded-md border border-dashed border-[var(--color-border)] p-3 text-left text-sm italic text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
        >
          Add a description…
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-2">
      <div
        ref={containerRef}
        className="prose prose-sm max-w-none break-words text-sm leading-relaxed [&_a]:cursor-pointer [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-center [&_ul[data-type=taskList]_li]:gap-1.5 [&_ul[data-type=taskList]_li>label]:flex [&_ul[data-type=taskList]_li>label]:items-start [&_ul[data-type=taskList]_li>label]:gap-1.5 [&_ul[data-type=taskList]_li>label>input]:shrink-0 [&_ul[data-type=taskList]_li>label>input]:accent-[var(--color-primary)] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md cursor-default"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
        onClick={onContainerClick}
      />
      {preview ? (
        <ImageLightbox
          taskServerId={preview.taskServerId}
          attachmentServerId={preview.attachmentServerId}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}
      <div className="flex items-center justify-start">
        {editBtn}
      </div>
    </div>
  );
}

function EditView({
  initial,
  onCancel,
  onSave,
  taskLocalId,
  taskServerId,
  mentionSearch,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (html: string) => Promise<void>;
  taskLocalId: string;
  taskServerId: number | null;
  mentionSearch?: MentionSearch;
}) {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

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

  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = () => {
    imageInputRef.current?.click();
  };

  useEffect(() => {
    _triggerImagePicker = handleImagePick;
    return () => { _triggerImagePicker = null; };
  }, []);

  const [uploadingImage, setUploadingImage] = useState(false);
  // Last image-upload error surfaced inline above the editor. Same
  // motivation as AttachmentList's opError: offline uploads fail hard
  // because attachments don't yet ride the outbox; silent failure
  // looks like the image was lost.
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  /**
   * Upload one or more image files to the task as attachments, then
   * insert each as an `<img src="<attachment-url>">` into the editor.
   * The url is the *server* attachment URL — `<api>/tasks/{id}/attachments/{id}` —
   * which our VikunjaImage extension swaps for an auth-fetched blob at
   * render time. Stored exactly the same way Vikunja-web stores it,
   * so the description round-trips between clients without translation.
   *
   * Disabled while the task hasn't yet got a server id; we have nothing
   * to attach to in that state. (Surface this in the toolbar.)
   */
  const uploadAndInsertImages = async (files: File[]) => {
    if (!editor || taskServerId == null || files.length === 0) return;
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const created = await uploadAttachment(taskServerId, taskLocalId, files);
      for (const att of created) {
        const url = buildAttachmentUrl(taskServerId, att.id);
        editor.chain().focus().setImage({ src: url }).run();
      }
    } catch (err) {
      console.error('[RichTextEditor] image upload failed:', err);
      if (isOfflineError(err)) {
        setImageUploadError("Couldn't upload image — check your connection and try again.");
      } else {
        const msg = String(err instanceof Error ? err.message : err);
        setImageUploadError(`Image upload failed: ${msg}`);
      }
    } finally {
      setUploadingImage(false);
    }
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await uploadAndInsertImages(files);
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
      // Underline is already provided by StarterKit (newer versions
      // bundle @tiptap/extension-underline). Adding it again triggered
      // "Duplicate extension names found: ['underline']" warnings.
      TaskList.configure({
        HTMLAttributes: { class: 'not-prose pl-0 space-y-1' },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { class: 'flex items-start gap-2' },
      }),
      ...(mentionSearch ? [buildMentionExtension(mentionSearch)] : []),
      VikunjaImage.configure({
        inline: false,
        // allowBase64 stays on so legacy descriptions with data: URIs
        // (anything saved by the parked wip/description-images branch)
        // still round-trip without being stripped on parse. New images
        // go through the upload path and never hit base64.
        allowBase64: true,
        HTMLAttributes: { class: 'max-w-full h-auto rounded-md' },
      }),
    ],
    content: initial || '<p></p>',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[6rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm leading-relaxed break-words focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-center [&_ul[data-type=taskList]_li]:gap-1.5 [&_ul[data-type=taskList]_li>label]:flex [&_ul[data-type=taskList]_li>label]:items-start [&_ul[data-type=taskList]_li>label]:gap-1.5 [&_ul[data-type=taskList]_li>label>input]:shrink-0 [&_ul[data-type=taskList]_li>label>input]:accent-[var(--color-primary)] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md',
      },
      // Clipboard paste of image files → upload + insert. Returning
      // true tells ProseMirror we handled the event so its default
      // (which would either ignore the binary or paste a tag-less mess)
      // doesn't run. Non-image pastes fall through.
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items || items.length === 0) return false;
        const files: File[] = [];
        for (const it of items) {
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length === 0) return false;
        if (taskServerId == null) {
          // Better to silently no-op + log than to lose the user's
          // clipboard contents to a half-handled paste.
          console.warn('[RichTextEditor] paste-image ignored: task not synced yet');
          return true;
        }
        event.preventDefault();
        void uploadAndInsertImages(files);
        return true;
      },
      // Drag-and-drop of image files. Same logic as paste; the only
      // wrinkle is `event.dataTransfer.files` (a FileList).
      handleDrop(_view, event) {
        const dt = (event as DragEvent).dataTransfer;
        if (!dt?.files?.length) return false;
        const files = Array.from(dt.files).filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length === 0) return false;
        if (taskServerId == null) {
          console.warn('[RichTextEditor] drop-image ignored: task not synced yet');
          return true;
        }
        event.preventDefault();
        void uploadAndInsertImages(files);
        return true;
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
      setDirty(true);
    },
    onSelectionUpdate({ editor: editorInstance }) {
      checkSlash(editorInstance);
    },
  });

  const handleSave = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const html = editor.getHTML();
      // "Empty" means no text AND no media-only content. The earlier
      // check stripped every tag before testing for text, which treated
      // an image-only description (`<p><img …></p>`) as empty and saved
      // it as null — losing the user's inline upload. Now we also keep
      // anything with an <img> / <hr> / <input checkbox> (task-list)
      // as real content.
      const text = html.replace(/<[^>]*>/g, '').trim();
      const hasMedia = /<(img|hr|input)\b/i.test(html);
      const looksEmpty = text === '' && !hasMedia;
      await onSave(looksEmpty ? '' : html);
      setDirty(false);
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
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        onCancel();
      }
    };
    dom.addEventListener('keydown', handler);
    return () => dom.removeEventListener('keydown', handler);
  }, [editor, dirty]);

  // Persist task-list checkbox toggles immediately. We can't use
  // editorProps.handleClick — TipTap's TaskItem node view sets
  // contentEditable=false on the checkbox wrapper and preventDefault's
  // mousedown (see @tiptap/extension-list's addNodeView), so
  // ProseMirror's click pipeline never sees the event. The node view's
  // own `change` listener still fires the transaction internally, so
  // the doc state is already correct by the time our listener runs;
  // we just need to persist. Native `change` bubbles through the
  // editor DOM, so one listener at the root catches every checkbox.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onChange = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'checkbox') {
        void handleSave();
      }
    };
    dom.addEventListener('change', onChange);
    return () => dom.removeEventListener('change', onChange);
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
      <Toolbar
        editor={editor}
        onImagePick={handleImagePick}
        imagePickEnabled={taskServerId != null}
        imageUploading={uploadingImage}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageFile}
        className="hidden"
      />
      {imageUploadError ? (
        <InlineWarning onDismiss={() => setImageUploadError(null)}>
          {imageUploadError}
        </InlineWarning>
      ) : null}
      <div className="min-w-0 max-w-full">
        <EditorContent editor={editor} />
      </div>
      <div className="flex items-center justify-end gap-2 text-footnote text-[var(--color-muted-foreground)]">
        <span className="mr-auto">⌘+Enter · Esc · /commands</span>
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
                      'mt-0.5 text-micro leading-tight truncate',
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

function Toolbar({
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
