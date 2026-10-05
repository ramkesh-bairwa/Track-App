// How a track lays out its entries. Stored in tracks.view_type; every type
// uses the same columns + entries underneath, so switching between them later
// never loses data. 'table' is the original layout and the default for every
// track created before this setting existed.
export const TRACK_VIEW_TYPES = [
  {
    key: 'plain',
    label: 'Plain text',
    icon: 'fa-solid fa-align-left',
    hint: 'Simple "Field: value" lines — quick to scan and copy.',
  },
  {
    key: 'table',
    label: 'Tabular',
    icon: 'fa-solid fa-table',
    hint: 'Rows and columns with inline editing, resizing and reordering.',
  },
  {
    key: 'grid',
    label: 'Grid',
    icon: 'fa-solid fa-table-cells-large',
    hint: 'Each entry as a card in a responsive grid.',
  },
  {
    key: 'doc',
    label: 'Doc',
    icon: 'fa-solid fa-file-lines',
    hint: 'Each entry as a readable document section with a heading.',
  },
];

export const DEFAULT_VIEW_TYPE = 'table';

export function normalizeViewType(value) {
  return TRACK_VIEW_TYPES.some((t) => t.key === value) ? value : DEFAULT_VIEW_TYPE;
}

export function viewTypeMeta(value) {
  return TRACK_VIEW_TYPES.find((t) => t.key === normalizeViewType(value));
}
