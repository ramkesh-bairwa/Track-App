'use client';

import { useEffect, useState } from 'react';

const IMAGE = /^image\/(png|jpeg|gif|webp)$/i;
const PDF = /^application\/pdf$/i;
const VIDEO = /^video\/(mp4|webm|ogg)$/i;
const AUDIO = /^audio\//i;
const TEXT = /^(text\/(plain|csv|markdown|tab-separated-values)|application\/json)$/i;
const TEXT_EXT = /\.(txt|csv|tsv|json|md|log)$/i;
const MAX_TEXT = 200 * 1024;

export function previewKind(file) {
  const type = file.type || '';
  if (IMAGE.test(type)) return 'image';
  if (PDF.test(type) || /\.pdf$/i.test(file.name)) return 'pdf';
  if (VIDEO.test(type)) return 'video';
  if (AUDIO.test(type)) return 'audio';
  if (TEXT.test(type) || TEXT_EXT.test(file.name)) return 'text';
  return 'none';
}

export function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// A data: URL (a file picked but not posted yet) as a blob: URL — browsers
// refuse to show data: PDFs in frames, but blob: URLs work everywhere.
export function dataUrlToBlobUrl(dataUrl) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!match) return null;
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: match[1] || 'application/octet-stream' }));
}

function TextPreview({ url }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('Could not load the file.'))))
      .then((t) => alive && setText(t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n\n… (preview cut off — download for the full file)` : t))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [url]);
  if (error) return <p className="preview-none">{error}</p>;
  if (text === null) return <p className="preview-none">Loading…</p>;
  return <pre className="preview-text">{text}</pre>;
}

// Full-size viewer for attachments: images, PDFs, video, audio and text are
// shown in place; anything else shows its details with a Download button.
// files: [{ name, type, size, previewUrl, downloadUrl }]. ←/→ move between
// files, Esc closes.
export default function AttachmentPreview({ files, index: start = 0, onClose }) {
  const [index, setIndex] = useState(start);
  const file = files[index];
  const many = files.length > 1;

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (many && e.key === 'ArrowRight') setIndex((i) => (i + 1) % files.length);
      else if (many && e.key === 'ArrowLeft') setIndex((i) => (i - 1 + files.length) % files.length);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [files.length, many, onClose]);

  if (!file) return null;
  const kind = previewKind(file);

  return (
    <div className="preview-overlay" onClick={onClose} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="preview-box" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <div className="preview-title">
            <strong title={file.name}>{file.name}</strong>
            <span>
              {[file.type || 'Unknown type', fileSize(file.size), many ? `${index + 1} of ${files.length}` : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <a className="btn btn-sm" href={file.downloadUrl} download={file.name}>
            <i className="fa-solid fa-download" /> Download
          </a>
          <button type="button" className="new-track-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>

        <div className={`preview-stage preview-${kind}`}>
          {kind === 'image' && <img src={file.previewUrl} alt={file.name} />}
          {kind === 'pdf' && <iframe src={file.previewUrl} title={file.name} />}
          {kind === 'video' && <video src={file.previewUrl} controls />}
          {kind === 'audio' && <audio src={file.previewUrl} controls />}
          {kind === 'text' && <TextPreview url={file.previewUrl} />}
          {kind === 'none' && (
            <div className="preview-none">
              <i className="fa-solid fa-file" />
              <p>No preview for this type of file.</p>
              <a className="btn btn-primary btn-sm" href={file.downloadUrl} download={file.name}>Download {fileSize(file.size)}</a>
            </div>
          )}
          {many && (
            <>
              <button type="button" className="preview-nav prev" onClick={() => setIndex((i) => (i - 1 + files.length) % files.length)} title="Previous (←)">‹</button>
              <button type="button" className="preview-nav next" onClick={() => setIndex((i) => (i + 1) % files.length)} title="Next (→)">›</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
