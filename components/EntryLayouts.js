'use client';

import EntryCell from '@/components/EntryCell';
import { fieldTypeMeta } from '@/lib/fieldTypes';

// Alternative read layouts for a track's entries — plain text, grid and doc.
// The tabular layout stays in TrackView itself (it owns inline editing,
// column resizing and drag reordering); these share its row actions.

const TITLE_INPUTS = new Set(['text', 'email', 'link', 'url', 'tel', 'search', 'select', 'radio']);

function isEmpty(value) {
  return value === '' || value === null || value === undefined;
}

// The first filled-in text-like column reads as the entry's heading.
function titleColumnFor(columns, entry) {
  return columns.find(
    (c) => !c.is_auto_increment && TITLE_INPUTS.has(fieldTypeMeta(c.field_type).input) && !isEmpty(entry.data?.[c.field_key])
  );
}

// Same inline editor the table uses: click (or double-click) a value to edit
// it in place; Enter / clicking away saves, Escape cancels.
function Value({ column, entry, serial, onCellSave }) {
  return (
    <EntryCell
      column={column}
      value={entry.data ? entry.data[column.field_key] : ''}
      serial={serial}
      onSave={(val) => onCellSave(entry.id, column.field_key, val)}
    />
  );
}

function Actions({ entry, actions, compact }) {
  const cls = compact ? 'entry-layout-action' : 'entry-card-btn';
  return (
    <div className={compact ? 'entry-layout-actions' : 'entry-card-actions'}>
      {entry.is_locked ? (
        <button type="button" className={cls} onClick={() => actions.onUnlock(entry)}>🔓 Unlock</button>
      ) : (
        <>
          <button type="button" className={cls} onClick={() => actions.onView(entry)}>View</button>
          <button type="button" className={cls} onClick={() => actions.onEdit(entry)}>Edit</button>
          <button type="button" className={cls} onClick={() => actions.onLock(entry)}>🔒 Lock</button>
        </>
      )}
      <button
        type="button"
        className={`${cls} ${compact ? 'danger' : 'entry-card-btn-danger'}`}
        onClick={() => actions.onDelete(entry)}
      >
        Delete
      </button>
    </div>
  );
}

function Locked() {
  return (
    <div className="entry-layout-locked">
      <span className="cell-locked-dots">••••••••</span>
      <span className="cell-locked-label">This record is locked</span>
    </div>
  );
}

function PlainLayout({ columns, entries, serialById, actions, onCellSave }) {
  return (
    <div className="entry-plain">
      {entries.map((entry) => (
        <div key={entry.id} className="entry-plain-item">
          {entry.is_locked ? (
            <Locked />
          ) : (
            <dl className="entry-plain-lines">
              {columns.map((col) => (
                <div key={col.id} className="entry-plain-line">
                  <dt>{col.label}:</dt>
                  <dd><Value column={col} entry={entry} serial={serialById.get(entry.id)} onCellSave={onCellSave} /></dd>
                </div>
              ))}
            </dl>
          )}
          <Actions entry={entry} actions={actions} compact />
        </div>
      ))}
    </div>
  );
}

function GridLayout({ columns, entries, serialById, actions, onCellSave }) {
  return (
    <div className="entry-grid">
      {entries.map((entry) => {
        const titleCol = entry.is_locked ? null : titleColumnFor(columns, entry);
        return (
          <div key={entry.id} className={`entry-card entry-grid-card${entry.is_locked ? ' entry-card-locked' : ''}`}>
            <div className="entry-grid-title">
              {titleCol ? String(entry.data[titleCol.field_key]) : `Entry #${serialById.get(entry.id)}`}
            </div>
            {entry.is_locked ? (
              <Locked />
            ) : (
              <div className="entry-card-fields">
                {columns.map((col) => (
                    <div key={col.id} className="entry-card-field">
                      <span className="entry-card-label">{col.label}</span>
                      <span className="entry-card-value">
                        <Value column={col} entry={entry} serial={serialById.get(entry.id)} onCellSave={onCellSave} />
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <Actions entry={entry} actions={actions} />
          </div>
        );
      })}
    </div>
  );
}

function DocLayout({ columns, entries, serialById, actions, onCellSave }) {
  return (
    <div className="entry-doc">
      {entries.map((entry) => {
        const titleCol = entry.is_locked ? null : titleColumnFor(columns, entry);
        return (
          <section key={entry.id} className="entry-doc-section">
            <header className="entry-doc-head">
              <h3>
                <span className="entry-doc-num">{serialById.get(entry.id)}.</span>
                {titleCol ? String(entry.data[titleCol.field_key]) : 'Untitled entry'}
              </h3>
              <Actions entry={entry} actions={actions} compact />
            </header>
            {entry.is_locked ? (
              <Locked />
            ) : (
              columns.map((col) => (
                  <div key={col.id} className="entry-doc-field">
                    <h4>{col.label}</h4>
                    <div className="entry-doc-value">
                      <Value column={col} entry={entry} serial={serialById.get(entry.id)} onCellSave={onCellSave} />
                    </div>
                  </div>
                ))
            )}
          </section>
        );
      })}
    </div>
  );
}

export default function EntryLayouts({ viewType, columns, entries, serialById, actions, onCellSave, emptyMessage }) {
  if (entries.length === 0) {
    return <div className="entry-card-empty">{emptyMessage}</div>;
  }
  const props = { columns, entries, serialById, actions, onCellSave };
  if (viewType === 'plain') return <PlainLayout {...props} />;
  if (viewType === 'doc') return <DocLayout {...props} />;
  return <GridLayout {...props} />;
}
