'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import EntryCell from '@/components/EntryCell';
import AddColumnModal from '@/components/AddColumnModal';
import AddEntryModal from '@/components/AddEntryModal';
import ConfirmModal from '@/components/ConfirmModal';
import ColumnInfoModal from '@/components/ColumnInfoModal';
import RenameColumnModal from '@/components/RenameColumnModal';
import ViewEntryModal from '@/components/ViewEntryModal';
import EditEntryModal from '@/components/EditEntryModal';
import PrivacyPasswordModal from '@/components/PrivacyPasswordModal';
import TrackSettingsModal from '@/components/TrackSettingsModal';
import TrackIcon from '@/components/TrackIcon';
import EditTrackIconModal from '@/components/EditTrackIconModal';
import { NewTrackButton } from '@/components/NewTrackModal';
import SubtrackViews, { SUBTRACK_VIEWS } from '@/components/SubtrackViews';
import { fieldTypeMeta, emptyValueFor, optionList } from '@/lib/fieldTypes';
import ExportMenu from '@/components/ExportMenu';
import { trackExportTable } from '@/lib/trackExport';
import EntryLayouts from '@/components/EntryLayouts';
import { TRACK_VIEW_TYPES, normalizeViewType } from '@/lib/trackTypes';

const MIN_COL_WIDTH = 80;

export default function TrackView({ track, initialColumns, initialEntries, user, breadcrumbs, subtracks }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [columns, setColumns] = useState(initialColumns);
  const [entries, setEntries] = useState(initialEntries);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [infoColumn, setInfoColumn] = useState(null);
  const [renameColumn, setRenameColumn] = useState(null);
  const [privacyPrompt, setPrivacyPrompt] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [trackName, setTrackName] = useState(track.name);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(track.name);
  const [nameSaving, setNameSaving] = useState(false);
  const nameInputRef = useRef(null);
  const [trackIcon, setTrackIcon] = useState({ icon: track.icon, icon_type: track.icon_type });
  const [showIconEdit, setShowIconEdit] = useState(false);
  const [pageSize, setPageSize] = useState(track.page_size || 25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [error, setError] = useState('');
  const [colWidths, setColWidths] = useState({});
  const colRefs = useRef({});
  const storageKey = `mytrack_col_widths_${track.id}`;
  const [draggedColId, setDraggedColId] = useState(null);
  const [dragOverColId, setDragOverColId] = useState(null);
  const [draggedEntryId, setDraggedEntryId] = useState(null);
  const [dragOverEntryId, setDragOverEntryId] = useState(null);
  const [subtrackSearch, setSubtrackSearch] = useState('');
  const subtrackQuery = subtrackSearch.trim();
  const [subtrackView, setSubtrackView] = useState('cards');
  const [viewType, setViewType] = useState(normalizeViewType(track.view_type));

  // The track's type (plain / tabular / grid / doc) is saved on the track
  // itself, so it looks the same on every device.
  async function changeViewType(next) {
    if (next === viewType) return;
    const previous = viewType;
    setViewType(next);
    setError('');
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_type: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not change the track type.');
    } catch (err) {
      setViewType(previous);
      setError(err.message);
    }
  }

  // The sub-track layout is a per-browser display preference; cards stay the
  // default until someone picks something else.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('subtrackView');
      if (SUBTRACK_VIEWS.some((v) => v.key === saved)) setSubtrackView(saved);
    } catch {
      // storage unavailable — keep the default
    }
  }, []);

  function changeSubtrackView(key) {
    setSubtrackView(key);
    try {
      localStorage.setItem('subtrackView', key);
    } catch {
      // private browsing / storage full — the choice still applies this session
    }
  }

  const visibleSubtracks = useMemo(() => {
    if (!subtracks) return [];
    if (!subtrackQuery) return subtracks;
    const q = subtrackQuery.toLowerCase();
    return subtracks.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
    );
  }, [subtracks, subtrackQuery]);

  const filterColumns = columns.filter((c) => c.is_filterable);
  const searchColumns = columns.some((c) => c.is_searchable) ? columns.filter((c) => c.is_searchable) : columns;

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const data = entry.data || {};
      if (q) {
        const matches = searchColumns.some((col) =>
          String(data[col.field_key] ?? '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }
      for (const col of filterColumns) {
        const raw = filters[col.field_key];
        if (raw === undefined || raw === '') continue;
        const value = data[col.field_key];
        const meta = fieldTypeMeta(col.field_type);
        if (meta.input === 'checkbox') {
          if (String(Boolean(value)) !== raw) return false;
        } else if (meta.input === 'multiselect') {
          if (!optionList(value).includes(raw)) return false;
        } else if (meta.input === 'select' || meta.input === 'radio') {
          if (String(value ?? '') !== raw) return false;
        } else if (!String(value ?? '').toLowerCase().includes(raw.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }, [entries, search, filters, filterColumns, searchColumns]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageEntries = filteredEntries.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const serialById = useMemo(() => new Map(entries.map((e, i) => [e.id, i + 1])), [entries]);

  // Which record is open lives in the URL (?entry=<uuid>&mode=view|edit) — so
  // a specific record's view/edit modal can be linked to, bookmarked, or
  // survive a refresh, instead of only existing in transient component state.
  const entryParam = searchParams.get('entry');
  const modeParam = searchParams.get('mode');
  const activeEntry = entryParam ? entries.find((e) => e.uuid === entryParam) : null;
  const viewEntry = activeEntry && !activeEntry.is_locked && modeParam !== 'edit' ? activeEntry : null;
  const editEntry = activeEntry && !activeEntry.is_locked && modeParam === 'edit' ? activeEntry : null;

  function openEntry(entry, mode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('entry', entry.uuid);
    params.set('mode', mode);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeEntry() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('entry');
    params.delete('mode');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    setPage(1);
  }, [search, filters, pageSize]);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  async function handleSaveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === trackName) {
      setNameDraft(trackName);
      setEditingName(false);
      return;
    }
    setNameSaving(true);
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not rename this track.');
      setTrackName(trimmed);
      setEditingName(false);
      router.refresh();
    } catch (err) {
      setError(err.message);
      setNameDraft(trackName);
      setEditingName(false);
    } finally {
      setNameSaving(false);
    }
  }

  function handleNameKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      setNameDraft(trackName);
      setEditingName(false);
    }
  }

  function updateFilter(fieldKey, value) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === '') delete next[fieldKey];
      else next[fieldKey] = value;
      return next;
    });
  }

  // Gate a delete/edit action behind the privacy password when the user has
  // turned that requirement on. Resolves once verified, rejects if cancelled.
  function requirePrivacyPassword(message) {
    return new Promise((resolve, reject) => {
      setPrivacyPrompt({ message, resolve, reject });
    });
  }

  async function guardDelete(action) {
    if (user?.require_password_delete) {
      await requirePrivacyPassword('Enter your privacy password to confirm this deletion.');
    }
    return action();
  }

  async function guardEdit(action) {
    if (user?.require_password_edit) {
      await requirePrivacyPassword('Enter your privacy password to save this change.');
    }
    return action();
  }

  async function handleLockEntry(entryId) {
    if (!user?.has_action_password) {
      setError('Set a privacy password in Settings → Privacy before locking a record.');
      return;
    }
    const res = await fetch(`/api/tracks/${track.id}/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: true }),
    });
    if (!res.ok) {
      setError('Could not lock this entry.');
      return;
    }
    setEntries((rows) => rows.map((r) => (r.id === entryId ? { ...r, is_locked: true, data: null } : r)));
  }

  async function handleUnlockEntry(entry) {
    try {
      await requirePrivacyPassword('Enter your privacy password to unlock this record.');
    } catch {
      return;
    }
    const res = await fetch(`/api/tracks/${track.id}/entries/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: false }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || 'Could not unlock this entry.');
      return;
    }
    setEntries((rows) => rows.map((r) => (r.id === entry.id ? json.entry : r)));
  }

  // Column widths are a per-browser display preference, not track data —
  // load whatever was saved for this track the last time it was resized.
  useEffect(() => {
    try {
      setColWidths(JSON.parse(localStorage.getItem(storageKey) || '{}'));
    } catch {
      setColWidths({});
    }
  }, [storageKey]);

  const startResize = useCallback((e, colId) => {
    e.preventDefault();
    const th = e.currentTarget.closest('th');
    const headerCells = Array.from(th.parentElement.querySelectorAll('th')).slice(0, columns.length);

    // The very first resize freezes every column's current rendered width,
    // so switching from natural (auto) sizing to a fixed layout doesn't jump.
    setColWidths((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const frozen = {};
      columns.forEach((col, i) => {
        frozen[col.id] = Math.round(headerCells[i].getBoundingClientRect().width);
      });
      return frozen;
    });

    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    let liveWidth = startWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    // Mutate the <col> element directly while dragging instead of calling
    // setState per pixel — with many columns/rows a state update on every
    // mousemove re-renders the whole table and the drag visibly lags.
    function onMouseMove(ev) {
      liveWidth = Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX));
      const colEl = colRefs.current[colId];
      if (colEl) colEl.style.width = `${liveWidth}px`;
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setColWidths((prev) => {
        const next = { ...prev, [colId]: liveWidth };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // private browsing / storage full — resizing still works this session
        }
        return next;
      });
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [columns, storageKey]);

  async function persistColumnOrder(orderedColumns) {
    const res = await fetch(`/api/tracks/${track.id}/columns`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderedColumns.map((c) => c.id) }),
    });
    if (!res.ok) setError('Could not save the new column order.');
  }

  function handleColDragStart(e, colId) {
    // Buttons and the resize handle live inside the same header cell — only
    // a drag that starts elsewhere on the header should reorder the column.
    if (e.target.closest('button') || e.target.closest('.col-resize-handle')) {
      e.preventDefault();
      return;
    }
    setDraggedColId(colId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(colId));
  }

  function handleColDragOver(e, colId) {
    if (draggedColId == null || draggedColId === colId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColId(colId);
  }

  function handleColDragLeave(colId) {
    setDragOverColId((prev) => (prev === colId ? null : prev));
  }

  function handleColDragEnd() {
    setDraggedColId(null);
    setDragOverColId(null);
  }

  function handleColDrop(e, targetColId) {
    e.preventDefault();
    setDragOverColId(null);
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    if (!draggedId || draggedId === targetColId) return;
    const fromIndex = columns.findIndex((c) => c.id === draggedId);
    const toIndex = columns.findIndex((c) => c.id === targetColId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = columns.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setColumns(next);
    persistColumnOrder(next);
  }

  async function persistEntryOrder(orderedEntries) {
    const res = await fetch(`/api/tracks/${track.id}/entries`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderedEntries.map((e) => e.id) }),
    });
    if (!res.ok) setError('Could not save the new row order.');
  }

  function handleRowDragStart(e, entryId) {
    setDraggedEntryId(entryId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(entryId));
  }

  function handleRowDragEnd() {
    setDraggedEntryId(null);
    setDragOverEntryId(null);
  }

  function handleRowDragOver(e, entryId) {
    if (draggedEntryId == null || draggedEntryId === entryId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverEntryId(entryId);
  }

  function handleRowDragLeave(entryId) {
    setDragOverEntryId((prev) => (prev === entryId ? null : prev));
  }

  function handleRowDrop(e, targetEntryId) {
    e.preventDefault();
    setDragOverEntryId(null);
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    if (!draggedId || draggedId === targetEntryId) return;
    const fromIndex = entries.findIndex((r) => r.id === draggedId);
    const toIndex = entries.findIndex((r) => r.id === targetEntryId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = entries.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setEntries(next);
    persistEntryOrder(next);
  }

  async function handleRenameColumn(columnId, updates) {
    const res = await fetch(`/api/tracks/${track.id}/columns/${columnId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not save this column.');
    setColumns((cols) => cols.map((c) => (c.id === columnId ? { ...c, ...json.column } : c)));
    setRenameColumn(null);
  }

  function handleRenameColumnGated(columnId, updates) {
    return guardEdit(() => handleRenameColumn(columnId, updates));
  }

  async function handleCreateColumn({ label, field_type, options, field_length, auto_increment }) {
    const res = await fetch(`/api/tracks/${track.id}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, field_type, options, field_length, auto_increment }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not add column.');
    setColumns((cols) => [...cols, json.column]);
    setEntries((rows) => rows.map((r) => ({ ...r, data: { ...r.data, [json.column.field_key]: emptyValueFor(field_type) } })));
  }

  function handleDeleteColumn(columnId) {
    setConfirmState({
      title: 'Remove this column?',
      message: 'Data stored under it will no longer be shown.',
      confirmLabel: 'Remove column',
      danger: true,
      onConfirm: () =>
        guardDelete(async () => {
          const res = await fetch(`/api/tracks/${track.id}/columns/${columnId}`, { method: 'DELETE' });
          if (res.ok) {
            setColumns((cols) => cols.filter((c) => c.id !== columnId));
          }
        }),
    });
  }

  async function handleCreateEntry(values) {
    const res = await fetch(`/api/tracks/${track.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: values }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not save entry.');
    const entry = { ...json.entry, data: typeof json.entry.data === 'string' ? JSON.parse(json.entry.data) : json.entry.data };
    setEntries((rows) => [entry, ...rows]);
  }

  async function handleAddBlankRow() {
    const values = {};
    columns.forEach((c) => { values[c.field_key] = emptyValueFor(c.field_type); });
    try {
      await handleCreateEntry(values);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCellSave(entryId, fieldKey, value) {
    setEntries((rows) =>
      rows.map((r) => (r.id === entryId ? { ...r, data: { ...r.data, [fieldKey]: value } } : r))
    );
    const res = await fetch(`/api/tracks/${track.id}/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_key: fieldKey, value }),
    });
    if (!res.ok) setError('Could not save that change.');
  }

  async function handleUpdateEntry(entryId, values) {
    const res = await fetch(`/api/tracks/${track.id}/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: values }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not save this entry.');
    const entry = {
      ...json.entry,
      data: typeof json.entry.data === 'string' ? JSON.parse(json.entry.data) : json.entry.data,
    };
    setEntries((rows) => rows.map((r) => (r.id === entryId ? entry : r)));
  }

  function handleUpdateEntryGated(entryId, values) {
    return guardEdit(() => handleUpdateEntry(entryId, values));
  }

  function handleDeleteEntry(entryId) {
    setConfirmState({
      title: 'Delete this entry?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete entry',
      danger: true,
      onConfirm: () =>
        guardDelete(async () => {
          setEntries((rows) => rows.filter((r) => r.id !== entryId));
          await fetch(`/api/tracks/${track.id}/entries/${entryId}`, { method: 'DELETE' });
        }),
    });
  }

  function handleDeleteTrack() {
    setConfirmState({
      title: `Delete "${trackName}"?`,
      message:
        subtracks && subtracks.length > 0
          ? 'Everything in it — columns, entries, and all its sub-tracks — will be deleted. This cannot be undone.'
          : 'Everything in it — columns and entries — will be deleted. This cannot be undone.',
      confirmLabel: 'Delete track',
      danger: true,
      onConfirm: () =>
        guardDelete(async () => {
          await fetch(`/api/tracks/${track.id}`, { method: 'DELETE' });
          router.push('/dashboard');
          router.refresh();
        }),
    });
  }

  return (
    <>
      {breadcrumbs && breadcrumbs.length > 1 && (
        <div className="track-breadcrumbs">
          {breadcrumbs.map((b, i) => (
            <span key={b.id} className="track-breadcrumb-item">
              {i === breadcrumbs.length - 1 ? (
                <span>{b.name}</span>
              ) : (
                <>
                  <Link href={`/dashboard/tracks/${b.uuid}`}>{b.name}</Link>
                  <span className="track-breadcrumb-sep">/</span>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="page-head">
        <div>
          <h1>
            <button
              type="button"
              className="track-title-icon"
              style={{ background: `${track.color}22`, color: track.color }}
              onClick={() => setShowIconEdit(true)}
              title="Change this track's icon"
            >
              <TrackIcon track={{ ...track, ...trackIcon }} />
            </button>
            {editingName ? (
              <input
                ref={nameInputRef}
                className="input track-name-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={handleNameKeyDown}
                disabled={nameSaving}
              />
            ) : (
              <span
                className="track-name-text"
                onDoubleClick={() => {
                  setNameDraft(trackName);
                  setEditingName(true);
                }}
                title="Double-click to rename"
              >
                {trackName}
              </span>
            )}
          </h1>
          <p>{track.description || 'No description.'}</p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={() => setShowAddEntry(true)}>＋ Add entry</button>
          <button className="btn" onClick={() => setShowAddColumn(true)}>＋ Column</button>
          <NewTrackButton parentId={track.id} parentName={trackName} className="btn">
            ＋ Sub-track
          </NewTrackButton>
          <ExportMenu
            getTable={() => trackExportTable({ name: trackName, description: track.description }, columns, filteredEntries, serialById)}
            note={
              filteredEntries.length === entries.length
                ? `All ${entries.length} entries.`
                : `The ${filteredEntries.length} entries matching your search/filters.`
            }
          />
          <button className="btn" onClick={() => setShowSettings(true)} title="Filters, search & pagination">⚙ Settings</button>
          <button className="btn btn-danger" onClick={handleDeleteTrack}>Delete</button>
        </div>
      </div>

      {error && <div className="top-error">{error}</div>}

      {subtracks && subtracks.length > 0 && (
        <div className="track-grid-sub">
          <div className="subtrack-toolbar">
            <input
              type="search"
              className="input dashboard-search-input"
              placeholder="Search sub-tracks…"
              value={subtrackSearch}
              onChange={(e) => setSubtrackSearch(e.target.value)}
            />
            <div className="tabs" role="tablist" aria-label="Sub-track view">
              {SUBTRACK_VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={subtrackView === v.key}
                  className={`tab-btn${subtrackView === v.key ? ' active' : ''}`}
                  title={v.title}
                  onClick={() => changeSubtrackView(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {visibleSubtracks.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              No sub-tracks match “{subtrackQuery}”.
            </p>
          ) : (
            <SubtrackViews tracks={visibleSubtracks} view={subtrackView} query={subtrackQuery} />
          )}
        </div>
      )}

      {columns.length === 0 ? (
        <div className="empty-state">
          <h3>No structure yet</h3>
          <p>Add a column to start recording things in this track.</p>
          <button className="btn btn-primary" onClick={() => setShowAddColumn(true)}>＋ Add a column</button>
        </div>
      ) : (
        <>
        <div className="table-panel">
          <div className="table-toolbar">
            <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
              {filteredEntries.length === entries.length
                ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`
                : `${filteredEntries.length} of ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
            </span>
            <div className="table-toolbar-actions">
              <div className="tabs track-type-tabs" role="tablist" aria-label="Track type">
                {TRACK_VIEW_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={viewType === t.key}
                    className={`tab-btn${viewType === t.key ? ' active' : ''}`}
                    onClick={() => changeViewType(t.key)}
                    title={`${t.label} — ${t.hint}`}
                  >
                    <i className={t.icon} />
                    <span className="track-type-tab-label">{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="search-wrap">
                <span className="search-icon">⌕</span>
                <input
                  type="search"
                  className="input search-input"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button className="btn btn-sm" onClick={handleAddBlankRow}>＋ Quick row</button>
            </div>
          </div>

          {filterColumns.length > 0 && (
            <div className="filter-bar">
              {filterColumns.map((col) => {
                const meta = fieldTypeMeta(col.field_type);
                const value = filters[col.field_key] ?? '';
                if (meta.input === 'checkbox') {
                  return (
                    <label key={col.id} className="filter-field">
                      <span>{col.label}</span>
                      <select className="input input-sm" value={value} onChange={(e) => updateFilter(col.field_key, e.target.value)}>
                        <option value="">All</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </label>
                  );
                }
                if (meta.input === 'select' || meta.input === 'radio' || meta.input === 'multiselect') {
                  return (
                    <label key={col.id} className="filter-field">
                      <span>{col.label}</span>
                      <select className="input input-sm" value={value} onChange={(e) => updateFilter(col.field_key, e.target.value)}>
                        <option value="">All</option>
                        {optionList(col.options).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                  );
                }
                return (
                  <label key={col.id} className="filter-field">
                    <span>{col.label}</span>
                    <input
                      type="text"
                      className="input input-sm"
                      value={value}
                      onChange={(e) => updateFilter(col.field_key, e.target.value)}
                      placeholder="Contains…"
                    />
                  </label>
                );
              })}
              {Object.keys(filters).length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({})}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {viewType !== 'table' ? (
            <div className="entry-layout-wrap">
              <EntryLayouts
                viewType={viewType}
                columns={columns}
                entries={pageEntries}
                serialById={serialById}
                onCellSave={handleCellSave}
                emptyMessage={
                  entries.length === 0
                    ? 'No entries yet — add one with “＋ Add entry”.'
                    : 'No entries match your search/filters.'
                }
                actions={{
                  onView: (entry) => openEntry(entry, 'view'),
                  onEdit: (entry) => openEntry(entry, 'edit'),
                  onLock: (entry) => handleLockEntry(entry.id),
                  onUnlock: (entry) => handleUnlockEntry(entry),
                  onDelete: (entry) => handleDeleteEntry(entry.id),
                }}
              />
            </div>
          ) : (
          <>
          <div className="table-wrap">
            <table className="data-table" style={{ tableLayout: Object.keys(colWidths).length ? 'fixed' : 'auto' }}>
              <colgroup>
                <col style={{ width: 28 }} />
                {columns.map((col) => (
                  <col
                    key={col.id}
                    ref={(el) => {
                      if (el) colRefs.current[col.id] = el;
                    }}
                    style={colWidths[col.id] ? { width: `${colWidths[col.id]}px` } : undefined}
                  />
                ))}
                <col style={{ width: 104 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="row-drag-cell" />
                  {columns.map((col) => (
                    <th
                      key={col.id}
                      className={`${draggedColId === col.id ? 'col-dragging' : ''} ${dragOverColId === col.id ? 'col-drag-over' : ''}`.trim() || undefined}
                      draggable
                      onDragStart={(e) => handleColDragStart(e, col.id)}
                      onDragEnd={handleColDragEnd}
                      onDragOver={(e) => handleColDragOver(e, col.id)}
                      onDragLeave={() => handleColDragLeave(col.id)}
                      onDrop={(e) => handleColDrop(e, col.id)}
                    >
                      <div className="col-header" title="Drag to reorder this column">
                        <span className="col-header-label">
                          <span className="col-header-name">
                            {col.label}
                            {col.is_auto_increment ? ' · auto' : ''}
                          </span>
                        </span>
                        <span className="col-header-actions">
                          <button
                            type="button"
                            className="col-icon-btn"
                            onClick={() => setInfoColumn(col)}
                            title="Column details"
                          >
                            ⓘ
                          </button>
                          <button
                            type="button"
                            className="col-icon-btn"
                            onClick={() => setRenameColumn(col)}
                            title="Edit column name"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="col-icon-btn danger"
                            onClick={() => handleDeleteColumn(col.id)}
                            title="Remove column"
                          >
                            ×
                          </button>
                        </span>
                      </div>
                      <div className="col-resize-handle" onMouseDown={(e) => startResize(e, col.id)} />
                    </th>
                  ))}
                  <th className="row-actions-cell" />
                </tr>
              </thead>
              <tbody>
                {pageEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`${draggedEntryId === entry.id ? 'row-dragging' : ''} ${dragOverEntryId === entry.id ? 'row-drag-over' : ''} ${entry.is_locked ? 'row-locked' : ''}`.trim() || undefined}
                    onDragOver={(e) => handleRowDragOver(e, entry.id)}
                    onDragLeave={() => handleRowDragLeave(entry.id)}
                    onDrop={(e) => handleRowDrop(e, entry.id)}
                  >
                    <td className="row-drag-cell">
                      <span
                        className="row-drag-handle"
                        draggable
                        onDragStart={(e) => handleRowDragStart(e, entry.id)}
                        onDragEnd={handleRowDragEnd}
                        title="Drag to reorder this row"
                      >
                        ⠿
                      </span>
                    </td>
                    {entry.is_locked ? (
                      <td colSpan={columns.length} className="cell-locked-row">
                        <div className="cell-inner">
                          <span className="cell-locked-dots">••••••••</span>
                          <span className="cell-locked-label">Locked</span>
                        </div>
                      </td>
                    ) : (
                      columns.map((col) => (
                        <td key={col.id}>
                          <EntryCell
                            column={col}
                            value={entry.data ? entry.data[col.field_key] : ''}
                            serial={serialById.get(entry.id)}
                            onSave={(val) => handleCellSave(entry.id, col.field_key, val)}
                          />
                        </td>
                      ))
                    )}
                    <td className="row-actions-cell">
                      <div className="row-actions">
                        {entry.is_locked ? (
                          <button
                            type="button"
                            className="row-action-btn"
                            onClick={() => handleUnlockEntry(entry)}
                            title="Unlock entry"
                          >
                            🔓
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="row-action-btn"
                              onClick={() => openEntry(entry, 'view')}
                              title="View full entry"
                            >
                              👁
                            </button>
                            <button
                              type="button"
                              className="row-action-btn"
                              onClick={() => handleLockEntry(entry.id)}
                              title="Lock entry"
                            >
                              🔒
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="row-action-btn danger"
                          onClick={() => handleDeleteEntry(entry.id)}
                          title="Delete entry"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pageEntries.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 2}>
                      <div className="cell-inner cell-empty" style={{ padding: '20px 14px' }}>
                        {entries.length === 0
                          ? 'No entries yet — add one with the form, or use quick row to type directly into the table.'
                          : 'No entries match your search/filters.'}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list — shown instead of the table on small screens */}
          <div className="entry-card-list">
            {pageEntries.length === 0 ? (
              <div className="entry-card-empty">
                {entries.length === 0
                  ? 'No entries yet — tap “＋ Add entry” to get started.'
                  : 'No entries match your search/filters.'}
              </div>
            ) : (
              pageEntries.map((entry) => (
                <div key={entry.id} className={`entry-card${entry.is_locked ? ' entry-card-locked' : ''}`}>
                  {entry.is_locked ? (
                    <div className="entry-card-fields">
                      <div className="entry-card-field">
                        <span className="cell-locked-dots">••••••••</span>
                        <span className="cell-locked-label">This record is locked</span>
                      </div>
                    </div>
                  ) : (
                    <div className="entry-card-fields">
                      {columns.map((col) => {
                        const val = entry.data?.[col.field_key];
                        const isEmpty = val === '' || val === null || val === undefined;
                        return (
                          <div key={col.id} className="entry-card-field">
                            <span className="entry-card-label">{col.label}</span>
                            <span className={`entry-card-value${isEmpty ? ' entry-card-value-empty' : ''}`}>
                              {isEmpty ? '—' : String(val)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="entry-card-actions">
                    {entry.is_locked ? (
                      <button
                        type="button"
                        className="entry-card-btn"
                        onClick={(e) => { e.stopPropagation(); handleUnlockEntry(entry); }}
                      >
                        🔓 Unlock
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="entry-card-btn"
                          onClick={(e) => { e.stopPropagation(); openEntry(entry, 'view'); }}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="entry-card-btn"
                          onClick={(e) => { e.stopPropagation(); openEntry(entry, 'edit'); }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="entry-card-btn"
                          onClick={(e) => { e.stopPropagation(); handleLockEntry(entry.id); }}
                        >
                          🔒 Lock
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="entry-card-btn entry-card-btn-danger"
                      onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id); }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          </>
          )}

          {filteredEntries.length > 0 && (
            <div className="pagination-bar">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                ‹ Prev
              </button>
              <span className="pagination-status">Page {currentPage} of {totalPages}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                Next ›
              </button>
            </div>
          )}
        </div>
        </>
      )}

      {showAddColumn && (
        <AddColumnModal onClose={() => setShowAddColumn(false)} onCreate={handleCreateColumn} />
      )}
      {showAddEntry && (
        <AddEntryModal columns={columns} onClose={() => setShowAddEntry(false)} onCreate={handleCreateEntry} />
      )}
      {showSettings && (
        <TrackSettingsModal
          track={track}
          columns={columns}
          onClose={() => setShowSettings(false)}
          onSaved={(json) => {
            setPageSize(json.page_size);
            setColumns(json.columns);
          }}
        />
      )}
      {showIconEdit && (
        <EditTrackIconModal
          track={{ ...track, ...trackIcon }}
          onClose={() => setShowIconEdit(false)}
          onSaved={(updated) => {
            setTrackIcon(updated);
            router.refresh();
          }}
        />
      )}
      {confirmState && (
        <ConfirmModal {...confirmState} onClose={() => setConfirmState(null)} />
      )}
      {infoColumn && (
        <ColumnInfoModal column={infoColumn} onClose={() => setInfoColumn(null)} />
      )}
      {renameColumn && (
        <RenameColumnModal
          key={renameColumn.id}
          column={renameColumn}
          onClose={() => setRenameColumn(null)}
          onSave={(updates) => handleRenameColumnGated(renameColumn.id, updates)}
        />
      )}
      {viewEntry && (
        <ViewEntryModal
          columns={columns}
          entry={viewEntry}
          serial={serialById.get(viewEntry.id)}
          onClose={closeEntry}
          onEdit={() => openEntry(viewEntry, 'edit')}
        />
      )}
      {editEntry && (
        <EditEntryModal
          key={editEntry.id}
          columns={columns}
          entry={editEntry}
          onClose={closeEntry}
          onSave={(values) => handleUpdateEntryGated(editEntry.id, values)}
        />
      )}
      {privacyPrompt && (
        <PrivacyPasswordModal
          message={privacyPrompt.message}
          onVerified={() => {
            privacyPrompt.resolve();
            setPrivacyPrompt(null);
          }}
          onCancel={() => {
            privacyPrompt.reject(new Error('Cancelled — no changes were made.'));
            setPrivacyPrompt(null);
          }}
        />
      )}
    </>
  );
}
