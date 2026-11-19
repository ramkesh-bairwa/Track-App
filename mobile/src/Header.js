import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export default function Header({ title, canGoBack, onBack, right }) {
  return (
    <View style={s.bar}>
      <View style={s.side}>
        {canGoBack ? (
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={s.back}>‹ Back</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={s.title} numberOfLines={1}>{title}</Text>
      <View style={[s.side, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  side: { width: 72, justifyContent: 'center' },
  back: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
