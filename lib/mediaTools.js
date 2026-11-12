// Advanced media tools that run in the browser (no server, no paid API).
// Each entry names a `kind` that components/tools/MediaTool.js knows how to
// render. The catalog reads the slug set to mark these "Open".

export const MEDIA_TOOLS = {
  'audio-text-to-speech': {
    kind: 'tts',
    blurb: 'Type text and hear it read aloud — pick a voice, speed and pitch. Uses your device’s built-in voices.',
  },
};

export const MEDIA_TOOL_SLUGS = new Set(Object.keys(MEDIA_TOOLS));
export const mediaToolBySlug = (slug) => MEDIA_TOOLS[slug] || null;
