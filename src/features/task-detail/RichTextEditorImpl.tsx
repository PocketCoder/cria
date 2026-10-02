import { useEditor, EditorContent } from '@tiptap/react';
import { type MentionSearch } from './mentionExtension';
import { uploadAttachment } from '@/sync/attachments';
import { buildAttachmentUrl } from '@/sync/attachments';
import { useEffect, useState, useRef } from 'react';
import { useLatestRef } from '@/lib/useLatestRef';
import { sanitizeHtml } from '@/lib/sanitize';
import { isOfflineError } from '@/lib/errors';
import { InlineWarning } from '@/components/InlineWarning';
import { setImagePickerTrigger } from './editorCommands';
import { buildExtensions, EDITOR_CLASS } from './editorConfig';
import {
  imageFilesFromClipboard,
  imageFilesFromDrop,
  imageUploadMessage,
  looksEmptyHtml,
  slashKeyAction,
  stepSlashIndex,
} from './editorLogic';
import { ReadView } from './RichTextReadView';
import { Toolbar } from './EditorToolbar';
import { SlashMenu } from './SlashMenu';
import { useSlashMenu } from './useSlashMenu';

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

  const { slashStateRef, slashUI, updateSlashState, checkSlash, executeSlashCommand } =
    useSlashMenu();

  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = () => {
    imageInputRef.current?.click();
  };

  useEffect(() => {
    setImagePickerTrigger(handleImagePick);
    return () => { setImagePickerTrigger(null); };
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
      setImageUploadError(imageUploadMessage(err, isOfflineError(err)));
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
    extensions: buildExtensions(mentionSearch),
    content: initial || '<p></p>',
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: EDITOR_CLASS,
      },
      // Clipboard paste of image files → upload + insert. Returning
      // true tells ProseMirror we handled the event so its default
      // (which would either ignore the binary or paste a tag-less mess)
      // doesn't run. Non-image pastes fall through.
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items || items.length === 0) return false;
        const files = imageFilesFromClipboard(items);
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
        const files = imageFilesFromDrop(dt.files);
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
        if (!slashStateRef.current.open) return false;
        const { count, selectedIndex } = {
          count: slashStateRef.current.filteredCommandsCount,
          selectedIndex: slashStateRef.current.selectedIndex,
        };
        const action = slashKeyAction(event.key, count);
        if (action === null) return false;
        event.preventDefault();
        if (action === 'next') {
          updateSlashState({ selectedIndex: stepSlashIndex(selectedIndex, count, 1) });
        } else if (action === 'prev') {
          updateSlashState({ selectedIndex: stepSlashIndex(selectedIndex, count, -1) });
        } else if (action === 'execute') {
          const editorInstance = (view as unknown as { editor?: typeof editor }).editor || editor;
          if (editorInstance) {
            executeSlashCommand(selectedIndex, editorInstance);
          }
        } else {
          updateSlashState({ open: false });
        }
        return true;
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
      await onSave(looksEmptyHtml(html) ? '' : html);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+Enter to save while editor has focus. Handlers via refs so a
  // new onSave/onCancel (e.g. after switching tasks) is always the one called.
  const keyHandlersRef = useLatestRef({ handleSave, onCancel });
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void keyHandlersRef.current.handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        keyHandlersRef.current.onCancel();
      }
    };
    dom.addEventListener('keydown', handler);
    return () => dom.removeEventListener('keydown', handler);
  }, [editor, dirty, keyHandlersRef]);

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
        void keyHandlersRef.current.handleSave();
      }
    };
    dom.addEventListener('change', onChange);
    return () => dom.removeEventListener('change', onChange);
  }, [editor, keyHandlersRef]);

  if (!editor) return null;

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
      <EditorFooter saving={saving} onCancel={onCancel} onSave={() => void handleSave()} />

      {slashUI.open && (
        <SlashMenu
          query={slashUI.query}
          coords={slashUI.coords}
          selectedIndex={slashUI.selectedIndex}
          onPick={(idx) => executeSlashCommand(idx, editor)}
          onHover={(idx) => updateSlashState({ selectedIndex: idx })}
        />
      )}
    </div>
  );
}

function EditorFooter({
  saving,
  onCancel,
  onSave,
}: {
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
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
        onClick={onSave}
        disabled={saving}
        className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
