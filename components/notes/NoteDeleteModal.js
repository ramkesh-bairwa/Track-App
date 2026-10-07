'use client';

import PasswordConfirmModal from '@/components/PasswordConfirmModal';

// Deleting a note needs a password, checked by DELETE /api/notes/:id.
export default function NoteDeleteModal({ note, hasSubnotes, onDeleted, onCancel }) {
  async function remove(password) {
    const res = await fetch(`/api/notes/${note.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Could not delete this note.');
    onDeleted();
  }

  return (
    <PasswordConfirmModal
      title={`Delete “${note.title}”?`}
      message={
        hasSubnotes
          ? 'Everything in it — including all its sub-notes — will be deleted. This cannot be undone.'
          : 'This cannot be undone.'
      }
      confirmLabel="Delete note"
      onConfirm={remove}
      onCancel={onCancel}
    />
  );
}
