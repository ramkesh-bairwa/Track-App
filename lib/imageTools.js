// Image file-tools registry. Each takes an uploaded image, processes it on a
// <canvas> in the browser, and gives the new image back. Config drives
// components/tools/ImageTool.js; the catalog reads the slug set for "Open".

export const IMAGE_TOOLS = {
  'images-format-converter': {
    action: 'convert',
    blurb: 'Convert between PNG, JPG and WEBP.',
    inputs: [{ key: 'fmt', label: 'Convert to', type: 'select', options: ['PNG', 'JPEG', 'WEBP'], default: 'PNG' }],
  },
  'images-resizer': {
    action: 'resize',
    blurb: 'Resize to an exact width/height (blank one to keep aspect ratio).',
    inputs: [{ key: 'w', label: 'Width (px)', type: 'number' }, { key: 'h', label: 'Height (px)', type: 'number' }],
  },
  'images-cropper': {
    action: 'crop',
    blurb: 'Crop a rectangle by pixel coordinates.',
    inputs: [{ key: 'x', label: 'X', type: 'number', default: '0' }, { key: 'y', label: 'Y', type: 'number', default: '0' }, { key: 'w', label: 'Width', type: 'number' }, { key: 'h', label: 'Height', type: 'number' }],
  },
  'images-watermark': {
    action: 'watermark',
    blurb: 'Stamp text across the image.',
    inputs: [{ key: 'text', label: 'Watermark text', default: '© MyTrack' }],
  },
  'images-metadata-remover': {
    action: 'strip',
    blurb: 'Re-encode the image to drop EXIF/location metadata.',
    inputs: [],
  },
  'images-blur-tool': {
    action: 'blur',
    blurb: 'Apply a Gaussian blur.',
    inputs: [{ key: 'px', label: 'Blur radius (px)', type: 'number', default: '6' }],
  },
  'images-border-maker': {
    action: 'border',
    blurb: 'Add a solid border around the image.',
    inputs: [{ key: 'size', label: 'Border width (px)', type: 'number', default: '20' }, { key: 'color', label: 'Colour', default: '#ffffff' }],
  },
  'images-rounded-corners-tool': {
    action: 'round',
    blurb: 'Round the corners (exports a transparent PNG).',
    inputs: [{ key: 'radius', label: 'Corner radius (px)', type: 'number', default: '40' }],
  },
  'images-rotate': {
    action: 'rotate',
    blurb: 'Rotate the image by 90/180/270°.',
    inputs: [{ key: 'deg', label: 'Rotate by', type: 'select', options: ['90', '180', '270'], default: '90' }],
  },
  'images-flip': {
    action: 'flip',
    blurb: 'Mirror the image horizontally or vertically.',
    inputs: [{ key: 'dir', label: 'Direction', type: 'select', options: ['Horizontal', 'Vertical'], default: 'Horizontal' }],
  },
  'images-grayscale': {
    action: 'grayscale',
    blurb: 'Convert the image to black & white.',
    inputs: [],
  },
};

export const IMAGE_TOOL_SLUGS = new Set(Object.keys(IMAGE_TOOLS));
export const imageToolBySlug = (slug) => IMAGE_TOOLS[slug] || null;
