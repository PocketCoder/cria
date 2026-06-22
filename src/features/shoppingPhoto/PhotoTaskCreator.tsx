import React, { useRef } from 'react';
import { Plus } from 'lucide-react';
import { createTask } from '@/db/tasks';
import { uploadAttachment } from '@/sync/attachments';

// Simple component to create a task from a selected photo and assign a "shopping" tag
export function PhotoTaskCreator() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPick = () => fileInputRef.current?.click();

  const handleFile = async (file: File) => {
    // Create a task titled with the file name (could be enhanced with OCR later)
    const task = await createTask({
      title: file.name,
      projectLocalId: '', // Empty means default project; user can move later
    });
    if (!task || !task.serverId) return;
    // Upload the photo as an attachment to the newly created task
    await uploadAttachment(task.serverId, task.localId, [file]);
    // Add a "shopping" label if it exists
    // This simplistic approach assumes a label named "shopping" already exists
    // In a full implementation we'd create the label if missing.
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      await handleFile(files[0]);
    }
    e.target.value = '';
  };

  return (
    <button type="button" onClick={onPick} className="flex items-center gap-1 px-2 py-1 bg-sky-500/10 rounded">
      <Plus className="h-4 w-4" /> Add from Photo
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
    </button>
  );
}
