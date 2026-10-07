'use client';

import { useState } from 'react';
import { MAX_TASK_FILE_BYTES, MAX_TASK_IMAGES } from '@/lib/taskConfig';
import FilePreviewModal from '@/components/FilePreviewModal';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// The server's limit is on the data URL (base64 is ~4/3 of the file).
const MAX_DATA_URL = MAX_TASK_FILE_BYTES * 1.33;

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = src;
  });
}

// Big screenshots are scaled down / re-encoded until they fit the size limit.
async function fitImage(file) {
  const original = await readAsDataUrl(file);
  if (original.length <= MAX_DATA_URL) return { type: file.type, data: original };
  const img = await loadImage(original);
  for (const maxSide of [2400, 1800, 1280, 960]) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', 0.85);
    // Browsers without WebP encoding fall back to PNG; use JPEG then.
    const out = data.startsWith('data:image/webp') ? data : canvas.toDataURL('image/jpeg', 0.85);
    if (out.length <= MAX_DATA_URL) return { type: out.slice(5, out.indexOf(';')), data: out };
  }
  throw new Error(`"${file.name}" is too large even after shrinking it.`);
}

export function imageFilesFrom(dataTransfer) {
  return Array.from(dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
}

function ImageGrid({ images, onOpen, onRemove }) {
  return (
    <div className="task-images-grid">
      {images.map((img, i) => (
        <figure key={i} className="task-image-thumb">
          <button type="button" className="task-image-open" onClick={() => onOpen(img)} title={`View ${img.name}`}>
            <img src={img.data} alt={img.name} />
          </button>
          <figcaption title={img.name}>{img.name}</figcaption>
          {onRemove && (
            <button type="button" className="task-image-remove" onClick={() => onRemove(i)} title="Remove image">×</button>
          )}
        </figure>
      ))}
    </div>
  );
}

// Read-only thumbnails (click to view full size).
export function TaskImagesView({ images }) {
  const [open, setOpen] = useState(null);
  if (!images?.length) return <span className="cell-empty">—</span>;
  return (
    <>
      <ImageGrid images={images} onOpen={setOpen} />
      {open && <FilePreviewModal label={open.name} value={open.data} onClose={() => setOpen(null)} />}
    </>
  );
}

// Upload, drop or paste screenshots. `addRef` receives the add function so
// the modal can route a paste anywhere in the form here.
export default function TaskImagesInput({ value, onChange, addRef }) {
  const images = Array.isArray(value) ? value : [];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(null);

  async function add(files) {
    const list = files.filter((f) => ACCEPTED.includes(f.type));
    if (list.length < files.length) setError('Only PNG, JPEG, GIF and WebP images can be attached.');
    else setError('');
    if (list.length === 0) return;
    const room = MAX_TASK_IMAGES - images.length;
    if (room <= 0) {
      setError(`A task can have at most ${MAX_TASK_IMAGES} images.`);
      return;
    }
    if (list.length > room) setError(`Only ${room} more image${room === 1 ? '' : 's'} fit — a task can have ${MAX_TASK_IMAGES}.`);
    setBusy(true);
    const added = [];
    for (const file of list.slice(0, room)) {
      try {
        const { type, data } = await fitImage(file);
        // Pasted screenshots all arrive as "image.png"; give them a clearer name.
        const ext = type.split('/')[1].replace('jpeg', 'jpg');
        const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
        const name = file.name && file.name !== 'image.png' ? file.name : `Screenshot ${stamp}.${ext}`;
        added.push({ name, type, size: Math.round((data.length - data.indexOf(',') - 1) * 0.75), data });
      } catch (err) {
        setError(err.message);
      }
    }
    setBusy(false);
    if (added.length) onChange([...images, ...added]);
  }
  if (addRef) addRef.current = add;

  return (
    <div
      className={`task-images-drop${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.items || []).some((it) => it.kind === 'file')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        add(imageFilesFrom(e.dataTransfer));
      }}
    >
      {images.length > 0 && <ImageGrid images={images} onOpen={setOpen} onRemove={(i) => onChange(images.filter((_, j) => j !== i))} />}
      <div className="task-images-actions">
        <label className="btn btn-sm">
          {busy ? 'Adding…' : '🖼 Add images…'}
          <input
            type="file"
            accept={ACCEPTED.join(',')}
            multiple
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              add(files);
            }}
          />
        </label>
        <span className="field-hint">or drag them here, or paste a screenshot (Ctrl/⌘ + V)</span>
      </div>
      {error && <p className="field-hint" style={{ color: 'var(--danger)' }}>{error}</p>}
      {open && <FilePreviewModal label={open.name} value={open.data} onClose={() => setOpen(null)} />}
    </div>
  );
}
