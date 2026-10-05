// A track/sub-track's icon is one of three kinds, stored as (icon_type, icon):
//  - 'tag'   — a short text/emoji tag rendered in a colored badge (the original look)
//  - 'class' — a CSS icon-font class name (e.g. Font Awesome), rendered as <i className={icon} />
//  - 'image' — an uploaded image, stored inline as a data URL

export const ICON_TYPES = ['tag', 'class', 'image'];

export const DEFAULT_ICON_TAGS = ['01', '02', 'DB', 'UI', 'API', 'ENV', 'KEY', 'LOG', '★', '♥', '⚙', '📁'];

const ICON_IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/;
const MAX_ICON_IMAGE_LENGTH = 2_000_000; // ~1.5MB decoded, matches the avatar upload limit
const MAX_ICON_CLASS_LENGTH = 300;
const MAX_ICON_TAG_LENGTH = 12;

// Normalizes an (icon_type, icon) pair coming from a request body. Returns
// either { icon_type, icon } to store, or { error } if the value is invalid.
export function sanitizeIcon(rawType, rawValue) {
  const type = ICON_TYPES.includes(rawType) ? rawType : 'tag';
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';

  if (type === 'image') {
    if (!value) return { icon_type: 'tag', icon: '01' };
    if (!ICON_IMAGE_DATA_URL.test(value)) {
      return { error: 'Icon image must be an uploaded PNG, JPG, WEBP, GIF, or SVG file.' };
    }
    if (value.length > MAX_ICON_IMAGE_LENGTH) {
      return { error: 'That icon image is too large. Please pick one under 1.5MB.' };
    }
    return { icon_type: 'image', icon: value };
  }

  if (type === 'class') {
    const cls = value.slice(0, MAX_ICON_CLASS_LENGTH);
    if (!cls) return { icon_type: 'tag', icon: '01' };
    return { icon_type: 'class', icon: cls };
  }

  return { icon_type: 'tag', icon: (value || '01').slice(0, MAX_ICON_TAG_LENGTH) };
}
