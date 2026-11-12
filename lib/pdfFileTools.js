// PDF file-tools registry (the popular "do something to a PDF" utilities).
// Config drives components/tools/PdfTool.js, which does the work in the browser
// with pdf-lib + pdf.js (helpers in lib/pdfTools.js). The catalog reads the
// slug set to mark these "Open". Kept separate from lib/pdfTools.js, which holds
// the lower-level PDF-editor helpers used by the Text Extractor and PDF Editor.

export const PDF_TOOLS = {
  'pdf-merge': {
    action: 'merge', blurb: 'Combine several PDFs into one, in the order you add them.',
    multiple: true, inputs: [], download: 'merged.pdf',
  },
  'pdf-split': {
    action: 'split', blurb: 'Pull out a range of pages into a new PDF.',
    inputs: [{ key: 'range', label: 'Pages to keep (e.g. 1-3,5)', default: '1' }], download: 'split.pdf',
  },
  'pdf-page-reorder': {
    action: 'reorder', blurb: 'Rebuild the PDF in a new page order.',
    inputs: [{ key: 'order', label: 'New page order (e.g. 3,1,2)', default: '' }], download: 'reordered.pdf',
  },
  'pdf-page-rotator': {
    action: 'rotate', blurb: 'Rotate every page, or just some, by 90/180/270°.',
    inputs: [
      { key: 'deg', label: 'Rotate by', type: 'select', options: ['90', '180', '270'], default: '90' },
      { key: 'pages', label: 'Pages (blank = all, e.g. 1,2)', default: '' },
    ], download: 'rotated.pdf',
  },
  'pdf-watermark': {
    action: 'watermark', blurb: 'Stamp a diagonal text watermark across every page.',
    inputs: [{ key: 'text', label: 'Watermark text', default: 'CONFIDENTIAL' }], download: 'watermarked.pdf',
  },
  'pdf-metadata-viewer': {
    action: 'meta', blurb: 'Read a PDF’s title, author, page count, size and dates.',
    inputs: [], output: true,
  },
  'pdf-metadata-remover': {
    action: 'strip', blurb: 'Clear title, author, keywords and other metadata, then download.',
    inputs: [], download: 'cleaned.pdf',
  },
  // ---- popular conversions ----
  'pdf-image-to-pdf': {
    action: 'imgtopdf', blurb: 'Turn JPG/PNG images into a single PDF (one image per page).',
    accept: 'image/*', multiple: true, inputs: [], download: 'images.pdf',
  },
  'pdf-convert-to-txt': {
    action: 'totext', blurb: 'Extract all the text from a PDF.',
    inputs: [], output: true, textDownload: 'text.txt',
  },
  'pdf-convert-to-jpg': {
    action: 'toimage', imgMime: 'image/jpeg', blurb: 'Save a PDF page as a JPG image.',
    inputs: [{ key: 'page', label: 'Page number', type: 'number', default: '1' }],
  },
  'pdf-convert-to-png': {
    action: 'toimage', imgMime: 'image/png', blurb: 'Save a PDF page as a PNG image.',
    inputs: [{ key: 'page', label: 'Page number', type: 'number', default: '1' }],
  },
  'pdf-compress': {
    action: 'compress', blurb: 'Re-save and optimise a PDF to shrink it where possible.',
    inputs: [], download: 'compressed.pdf',
  },
  'pdf-add-page-numbers': {
    action: 'pagenum', blurb: 'Stamp page numbers on every page.',
    inputs: [{ key: 'pos', label: 'Position', type: 'select', options: ['Bottom center', 'Bottom right', 'Top right'], default: 'Bottom center' }],
    download: 'numbered.pdf',
  },
  'pdf-delete-pages': {
    action: 'delete', blurb: 'Remove specific pages from a PDF.',
    inputs: [{ key: 'pages', label: 'Pages to delete (e.g. 2,4-5)', default: '1' }],
    download: 'edited.pdf',
  },
};

export const PDF_TOOL_SLUGS = new Set(Object.keys(PDF_TOOLS));
export const pdfToolBySlug = (slug) => PDF_TOOLS[slug] || null;
