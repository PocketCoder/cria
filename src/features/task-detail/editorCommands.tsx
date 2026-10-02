import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Terminal,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Image,
} from 'lucide-react';

let imagePickerTrigger: (() => void) | null = null;

/** Register (or clear) what the slash menu's "Image" command opens. */
export function setImagePickerTrigger(fn: (() => void) | null) {
  imagePickerTrigger = fn;
}

function triggerImagePicker() {
  imagePickerTrigger?.();
}

export const COMMANDS = [
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
    action: () => triggerImagePicker(),
  },
];

/** Slash-menu commands matching `query` by key or label (case-insensitive). */
export function filterCommands(query: string) {
  const queryLower = query.toLowerCase();
  return COMMANDS.filter(
    (cmd) =>
      cmd.key.toLowerCase().includes(queryLower) ||
      cmd.label.toLowerCase().includes(queryLower),
  );
}
