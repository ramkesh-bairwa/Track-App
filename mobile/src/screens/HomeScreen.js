import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../Header';
import { colors } from '../theme';

const TILES = [
  { name: 'Tracks', label: 'Tracks', emoji: '🗂️', hint: 'Your trackers & records' },
  { name: 'Tasks', label: 'Task boards', emoji: '✅', hint: 'Boards & assigned tasks' },
  { name: 'Notes', label: 'Notes', emoji: '📝', hint: 'Your notes' },
];

export default function HomeScreen({ nav, auth }) {
  return (
    <View style={{ flex: 1 }}>
      <Header
        title="MyTrack"
        right={
          <Pressable onPress={auth.signOut} hitSlop={10}>
            <Text style={s.logout}>Log out</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.hello}>Hi, {auth.user?.name || 'there'} 👋</Text>
        <Text style={s.email}>{auth.user?.email || ''}</Text>

        <View style={s.grid}>
          {TILES.map((t) => (
            <Pressable
              key={t.name}
              style={({ pressed }) => [s.tile, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => nav.navigate(t.name)}
            >
              <Text style={s.emoji}>{t.emoji}</Text>
              <Text style={s.tileLabel}>{t.label}</Text>
              <Text style={s.tileHint}>{t.hint}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.note}>
          Everything here loads live from your MyTrack server over its API — the
          same account as the website.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, gap: 6 },
  hello: { color: colors.text, fontSize: 24, fontWeight: '800' },
  email: { color: colors.muted, fontSize: 14, marginBottom: 18 },
  logout: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  grid: { gap: 14 },
  tile: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
  emoji: { fontSize: 30 },
  tileLabel: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 6 },
  tileHint: { color: colors.muted, fontSize: 13, marginTop: 2 },
  note: { color: colors.muted, fontSize: 13, marginTop: 26, lineHeight: 19 },
});
