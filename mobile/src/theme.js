export const colors = {
  bg: '#F4F5FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  text: '#0F172A',
  sub: '#475569',
  muted: '#94A3B8',
  border: '#ECEEF5',
  primary: '#6366F1',
  primaryDark: '#4F46E5',
  onPrimary: '#FFFFFF',
  danger: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
};

// Gradient pairs used for hero headers, the logo mark and primary buttons.
export const gradients = {
  brand: ['#6366F1', '#8B5CF6'],
  brandSoft: ['#818CF8', '#A78BFA'],
  night: ['#4F46E5', '#7C3AED'],
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };

// Soft, layered shadow. level 0–3.
export const shadow = (level = 1) => ({
  shadowColor: '#1E293B',
  shadowOpacity: 0.05 + level * 0.02,
  shadowRadius: 6 + level * 5,
  shadowOffset: { width: 0, height: 2 + level * 2 },
  elevation: 2 + level * 3,
});

// Soft tinted pairs for icon tiles / accents.
export const tints = {
  indigo: { bg: '#EEF0FE', fg: '#4F46E5' },
  emerald: { bg: '#E6F8F1', fg: '#059669' },
  amber: { bg: '#FEF3E2', fg: '#D97706' },
  rose: { bg: '#FDEBEF', fg: '#E11D48' },
  sky: { bg: '#E6F4FD', fg: '#0284C7' },
  violet: { bg: '#F3ECFE', fg: '#7C3AED' },
  slate: { bg: '#EEF1F6', fg: '#475569' },
};
