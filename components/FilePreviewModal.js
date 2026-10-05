'use client';

import { detectFileKind, decodeBase64Text } from '@/lib/fieldTypes';
import { safeFileUrl } from '@/lib/safeUrl';

export default function FilePreviewModal({ label, value, onClose }) {
  const kind = detectFileKind(value);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-file-preview" onClick={(e) => e.stopPropagation()}>
        <h2>{label || 'File preview'}</h2>
        <div className="file-preview-body">
          {kind === 'image' && <img src={value} alt="" className="file-preview-image" />}
          {kind === 'pdf' && <iframe src={value} title={label || 'PDF preview'} className="file-preview-frame" />}
          {kind === 'text' && <pre className="file-preview-text">{decodeBase64Text(value)}</pre>}
          {kind === 'other' && (
            <p className="field-hint" style={{ padding: 20 }}>
              This file type can&apos;t be previewed here — download it to view it.
            </p>
          )}
        </div>
        <div className="modal-actions">
          <a className="btn" href={safeFileUrl(value) || undefined} download={label ? `${label}` : true}>⇩ Download</a>
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
