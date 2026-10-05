// File extension → language, for the code saver's label and highlighting.
export const CODE_LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', ext: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'typescript', label: 'TypeScript', ext: ['ts', 'tsx'] },
  { id: 'python', label: 'Python', ext: ['py'] },
  { id: 'php', label: 'PHP', ext: ['php'] },
  { id: 'java', label: 'Java', ext: ['java'] },
  { id: 'c', label: 'C / C++', ext: ['c', 'h', 'cpp', 'hpp', 'cc'] },
  { id: 'csharp', label: 'C#', ext: ['cs'] },
  { id: 'go', label: 'Go', ext: ['go'] },
  { id: 'rust', label: 'Rust', ext: ['rs'] },
  { id: 'ruby', label: 'Ruby', ext: ['rb'] },
  { id: 'kotlin', label: 'Kotlin', ext: ['kt'] },
  { id: 'swift', label: 'Swift', ext: ['swift'] },
  { id: 'dart', label: 'Dart', ext: ['dart'] },
  { id: 'sql', label: 'SQL', ext: ['sql'] },
  { id: 'html', label: 'HTML', ext: ['html', 'htm', 'xml', 'svg', 'vue'] },
  { id: 'css', label: 'CSS', ext: ['css', 'scss', 'sass', 'less'] },
  { id: 'json', label: 'JSON', ext: ['json'] },
  { id: 'yaml', label: 'YAML', ext: ['yml', 'yaml'] },
  { id: 'shell', label: 'Shell', ext: ['sh', 'bash', 'zsh', 'env'] },
  { id: 'markdown', label: 'Markdown', ext: ['md'] },
  { id: 'text', label: 'Plain text', ext: ['txt'] },
];

export function languageForName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower === 'dockerfile' || lower === 'makefile') return 'shell';
  if (lower.startsWith('.env')) return 'shell';
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  return CODE_LANGUAGES.find((l) => l.ext.includes(ext))?.id || 'text';
}

export function languageLabel(id) {
  return CODE_LANGUAGES.find((l) => l.id === id)?.label || 'Plain text';
}
