import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { buildMentionExtension, type MentionSearch } from './mentionExtension';
import { VikunjaImage } from './tiptapImageExtension';

export const EDITOR_CLASS =
  'prose prose-sm max-w-none min-h-[6rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm leading-relaxed break-words focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-center [&_ul[data-type=taskList]_li]:gap-1.5 [&_ul[data-type=taskList]_li>label]:flex [&_ul[data-type=taskList]_li>label]:items-start [&_ul[data-type=taskList]_li>label]:gap-1.5 [&_ul[data-type=taskList]_li>label>input]:shrink-0 [&_ul[data-type=taskList]_li>label>input]:accent-[var(--color-primary)] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md';

export function buildExtensions(mentionSearch: MentionSearch | undefined) {
  return [
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
  ];
}
