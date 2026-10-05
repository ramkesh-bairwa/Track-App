// Collage layouts, written like CSS grid-template-areas: each letter is one
// photo cell, repeated letters span. "ab/cc" = two on top, one wide below.

const LAYOUT_SPECS = [
  ['1', 'a'],
  ['2 photos · Horizontal (side by side)', 'ab'],
  ['2 photos · Vertical (stacked)', 'a/b'],
  ['2 wide + narrow', 'aab'],
  ['2 narrow + wide', 'abb'],
  ['2 tall top', 'a/a/b'],
  ['3 columns', 'abc'],
  ['3 rows', 'a/b/c'],
  ['3 big left', 'ab/ac'],
  ['3 big right', 'ab/cb'],
  ['3 big top', 'aa/bc'],
  ['3 big bottom', 'ab/cc'],
  ['3 hero left', 'aab/aac'],
  ['3 hero top', 'aaa/aaa/bcc'],
  ['4 grid', 'ab/cd'],
  ['4 columns', 'abcd'],
  ['4 rows', 'a/b/c/d'],
  ['4 big left', 'ab/ac/ad'],
  ['4 big top', 'aaa/bcd'],
  ['4 big bottom', 'bcd/aaa'],
  ['4 big right', 'ba/ca/da'],
  ['4 hero + strip', 'aaab/aaac/aaad'],
  ['4 staggered', 'aab/cdd'],
  ['5 two over three', 'aaabbb/ccddee'],
  ['5 three over two', 'aabbcc/dddeee'],
  ['5 big left + grid', 'abc/ade'],
  ['5 big top + four', 'aaaa/aaaa/bcde'],
  ['5 centre focus', 'abc/dbe'],
  ['5 hero + column', 'aab/aac/aad/aae'],
  ['6 grid 3×2', 'abc/def'],
  ['6 grid 2×3', 'ab/cd/ef'],
  ['6 big corner', 'aab/aac/def'],
  ['6 hero top', 'aaaaa/aaaaa/bcdef'],
  ['6 mosaic', 'aabc/aade/ffde'],
  ['7 hero + six', 'aabc/aade/fgde'],
  ['7 mosaic', 'abbc/deef/dggf'],
  ['8 grid 4×2', 'abcd/efgh'],
  ['8 grid 2×4', 'ab/cd/ef/gh'],
  ['8 hero + seven', 'aabcd/aaefg/hhhhh'],
  ['9 grid 3×3', 'abc/def/ghi'],
  ['9 hero + eight', 'aabc/aade/fghi'],
  ['10 grid 5×2', 'abcde/fghij'],
  ['12 grid 4×3', 'abcd/efgh/ijkl'],
  ['2 cinema', 'a/a/a/b'],
  ['3 small left', 'abb/acc'],
  ['3 corner', 'aab/ccb'],
  ['3 tall middle', 'a/b/b/c'],
  ['4 three over wide', 'abc/ddd'],
  ['4 hero over wide', 'aab/aac/ddd'],
  ['4 window', 'abbc/addc'],
  ['4 tall hero + three', 'aaa/aaa/bcd'],
  ['5 halves + three', 'aabb/cdee'],
  ['5 side columns', 'abbc/deec'],
  ['5 pairs + wide', 'ab/cd/ee'],
  ['5 three rows', 'abc/ddd/eee'],
  ['5 film row', 'abcde'],
  ['5 film column', 'a/b/c/d/e'],
  ['6 halves + four', 'aabb/cdef'],
  ['6 panorama', 'abbc/abbd/eeff'],
  ['6 twin wide', 'abcc/deff'],
  ['6 film row', 'abcdef'],
  ['7 four + three', 'abcd/efgg'],
  ['7 hero right', 'aab/cdb/efg'],
  ['7 wide centre', 'abc/ddd/efg'],
  ['8 magazine', 'abcd/eeff/ghhh'],
  ['8 hero + strip', 'aabc/aade/fghh'],
  ['9 hero + rows', 'aabcd/aaefg/hhiii'],
  ['10 hero + nine', 'aabcd/aaefg/hhijj'],
  ['12 grid 6×2', 'abcdef/ghijkl'],
  ['16 grid 4×4', 'abcd/efgh/ijkl/mnop'],
];

// Grid spans for a spec: { nc, nr, spans: [{ c0, r0, c1, r1 }] } in cell
// order a, b, c… Column / row sizes are separate weights, so the editor can
// drag the grid lines without changing which photo sits where.
function parseGrid(spec) {
  const rows = spec.split('/').map((r) => r.trim().split(''));
  const nr = rows.length;
  const nc = Math.max(...rows.map((r) => r.length));
  const cells = new Map();
  rows.forEach((row, y) =>
    row.forEach((ch, x) => {
      const c = cells.get(ch) || { c0: x, r0: y, c1: x, r1: y };
      c.c0 = Math.min(c.c0, x);
      c.r0 = Math.min(c.r0, y);
      c.c1 = Math.max(c.c1, x);
      c.r1 = Math.max(c.r1, y);
      cells.set(ch, c);
    })
  );
  const spans = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c);
  return { nc, nr, spans };
}

// Fractional cell rectangles for given column / row weights.
export function gridCells(grid, colW, rowH) {
  const cw = colW && colW.length === grid.nc ? colW : Array(grid.nc).fill(1);
  const rh = rowH && rowH.length === grid.nr ? rowH : Array(grid.nr).fill(1);
  const sc = cw.reduce((a, b) => a + b, 0);
  const sr = rh.reduce((a, b) => a + b, 0);
  const cx = [0];
  cw.forEach((w) => cx.push(cx[cx.length - 1] + w / sc));
  const ry = [0];
  rh.forEach((h) => ry.push(ry[ry.length - 1] + h / sr));
  return grid.spans.map((s) => ({ x: cx[s.c0], y: ry[s.r0], w: cx[s.c1 + 1] - cx[s.c0], h: ry[s.r1 + 1] - ry[s.r0] }));
}

function parseAreas(spec) {
  return gridCells(parseGrid(spec));
}

export const COLLAGE_LAYOUTS = LAYOUT_SPECS.map(([label, spec], i) => ({ id: `l${i}`, label, spec, grid: parseGrid(spec), cells: parseAreas(spec) }))
  // Keep only well-formed rectangles (every letter must form a solid block).
  .filter((l) => l.cells.reduce((sum, c) => sum + c.w * c.h, 0) > 0.999 && l.cells.reduce((sum, c) => sum + c.w * c.h, 0) < 1.001);

export const CANVAS_PRESETS = [
  { id: 'square', label: 'Square', w: 2048, h: 2048 },
  { id: 'portrait', label: 'Portrait 4:5', w: 2048, h: 2560 },
  { id: 'story', label: 'Story 9:16', w: 1440, h: 2560 },
  { id: 'landscape', label: 'Landscape 16:9', w: 2560, h: 1440 },
  { id: 'photo', label: 'Photo 3:2', w: 2400, h: 1600 },
  { id: 'a4p', label: 'A4 portrait', w: 2480, h: 3508 },
  { id: 'a4l', label: 'A4 landscape', w: 3508, h: 2480 },
  { id: 'banner', label: 'Banner 3:1', w: 3000, h: 1000 },
];

export const BACKGROUNDS = [
  { id: 'white', label: 'White', css: '#ffffff' },
  { id: 'black', label: 'Black', css: '#111111' },
  { id: 'cream', label: 'Cream', css: '#f4efe6' },
  { id: 'slate', label: 'Slate', css: '#1f2430' },
  { id: 'sunset', label: 'Sunset', stops: ['#ff9a8b', '#ff6a88', '#ff99ac'] },
  { id: 'ocean', label: 'Ocean', stops: ['#2e3192', '#1bffff'] },
  { id: 'mint', label: 'Mint', stops: ['#d4fc79', '#96e6a1'] },
  { id: 'peach', label: 'Peach', stops: ['#ffecd2', '#fcb69f'] },
  { id: 'lavender', label: 'Lavender', stops: ['#e0c3fc', '#8ec5fc'] },
  { id: 'night', label: 'Night', stops: ['#0f2027', '#203a43', '#2c5364'] },
  { id: 'gold', label: 'Gold', stops: ['#f7971e', '#ffd200'] },
  { id: 'rose', label: 'Rose', stops: ['#f4c4f3', '#fc67fa'] },
];

export function backgroundCss(bg, custom) {
  if (bg === 'custom') return custom;
  const b = BACKGROUNDS.find((x) => x.id === bg) || BACKGROUNDS[0];
  return b.stops ? `linear-gradient(135deg, ${b.stops.join(', ')})` : b.css;
}
