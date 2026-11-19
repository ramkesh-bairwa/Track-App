import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, gradients, radius, shadow, tints } from './theme';

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style }) {
  const isPrimary = variant === 'primary';
  const content = (
    <View style={s.btnInner}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#fff' : colors.primary} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={isPrimary ? '#fff' : variant === 'danger' ? colors.danger : colors.primary} /> : null}
          <Text style={[s.btnText, { color: isPrimary ? '#fff' : variant === 'danger' ? colors.danger : colors.primary }]}>{title}</Text>
        </>
      )}
    </View>
  );
  const disabledStyle = { opacity: disabled ? 0.55 : 1 };
  if (isPrimary) {
    return (
      <Pressable onPress={disabled || loading ? undefined : onPress} style={({ pressed }) => [disabledStyle, { transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
        <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.btn, shadow(2)]}>
          {content}
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [s.btn, s.btnSoft, variant === 'danger' && s.btnDanger, disabledStyle, { opacity: pressed ? 0.8 : disabled ? 0.55 : 1 }, style]}
    >
      {content}
    </Pressable>
  );
}

export function Card({ children, onPress, style, level = 1 }) {
  const body = <View style={[s.card, shadow(level), style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.985 : 1 }], opacity: pressed ? 0.95 : 1 })}>
      {body}
    </Pressable>
  );
}

export function IconTile({ icon, tint = 'indigo', size = 46 }) {
  const t = tints[tint] || tints.indigo;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 3.2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size * 0.5} color={t.fg} />
    </View>
  );
}

export function Avatar({ name, uri, size = 44 }) {
  const initials = (name || '?').trim().slice(0, 1).toUpperCase();
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>{initials}</Text>
    </LinearGradient>
  );
}

export function Badge({ label, tint = 'slate' }) {
  const t = tints[tint] || tints.slate;
  return (
    <View style={{ backgroundColor: t.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Loading({ label }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={s.muted}>{label}</Text> : null}
    </View>
  );
}

export function Empty({ icon = 'sparkles-outline', title, subtitle }) {
  return (
    <View style={s.center}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={34} color={colors.primary} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={[s.muted, { textAlign: 'center' }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }) {
  return (
    <View style={s.center}>
      <View style={[s.emptyIcon, { backgroundColor: '#FDEBEF' }]}>
        <Ionicons name="cloud-offline-outline" size={32} color={colors.danger} />
      </View>
      <Text style={s.emptyTitle}>Something went wrong</Text>
      <Text style={[s.muted, { textAlign: 'center' }]}>{message}</Text>
      {onRetry ? <View style={{ height: 16 }} /> : null}
      {onRetry ? <Button title="Try again" icon="refresh" variant="soft" onPress={onRetry} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { borderRadius: radius.md, paddingVertical: 15, paddingHorizontal: 20 },
  btnSoft: { backgroundColor: '#EEF0FE' },
  btnDanger: { backgroundColor: '#FDEBEF' },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnText: { fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#EEF0FE', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
});
