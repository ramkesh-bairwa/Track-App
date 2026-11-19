import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export function Button({ title, onPress, variant = 'primary', disabled }) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.cardAlt;
  const fg = variant === 'primary' ? colors.primaryText : colors.text;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      <Text style={[s.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, onPress }) {
  const inner = <View style={s.card}>{children}</View>;
  if (!onPress) return inner;
  return <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{inner}</Pressable>;
}

export function Loading({ label }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={s.muted}>{label}</Text> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }) {
  return (
    <View style={s.center}>
      <Text style={[s.muted, { color: colors.danger, textAlign: 'center' }]}>{message}</Text>
      {onRetry ? <View style={{ height: 12 }} /> : null}
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="ghost" /> : null}
    </View>
  );
}

export function Empty({ message }) {
  return (
    <View style={s.center}>
      <Text style={s.muted}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  muted: { color: colors.muted, fontSize: 15 },
});
