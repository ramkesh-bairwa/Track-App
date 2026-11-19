import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, gradients, radius, shadow } from '../theme';
import { Avatar, Card, IconTile } from '../ui';

const TILES = [
  { name: 'Tracks', label: 'Tracks', hint: 'Your trackers & records', icon: 'albums-outline', tint: 'indigo' },
  { name: 'Tasks', label: 'Task boards', hint: 'Boards & assigned tasks', icon: 'checkbox-outline', tint: 'emerald' },
  { name: 'Notes', label: 'Notes', hint: 'Everything you jotted down', icon: 'document-text-outline', tint: 'amber' },
];

export default function HomeScreen({ nav, auth }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.greet}>{greet},</Text>
            <Text style={s.name} numberOfLines={1}>{auth.user?.name || 'there'} 👋</Text>
            <Text style={s.email} numberOfLines={1}>{auth.user?.email || ''}</Text>
          </View>
          <Pressable onPress={auth.signOut} hitSlop={10} style={s.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color="#fff" />
          </Pressable>
        </View>
        <View style={s.avatarRow}>
          <Avatar name={auth.user?.name} uri={auth.user?.avatar} size={52} />
          <View style={s.statusPill}>
            <View style={s.dot} />
            <Text style={s.statusText}>Synced with the web</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={s.body}>
        <Text style={s.section}>Workspace</Text>
        <View style={{ gap: 12 }}>
          {TILES.map((t) => (
            <Card key={t.name} onPress={() => nav.navigate(t.name)}>
              <View style={s.tileRow}>
                <IconTile icon={t.icon} tint={t.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={s.tileLabel}>{t.label}</Text>
                  <Text style={s.tileHint}>{t.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </View>
            </Card>
          ))}
        </View>

        <View style={[s.note, shadow(0)]}>
          <Ionicons name="cloud-done-outline" size={20} color={colors.primary} />
          <Text style={s.noteText}>Everything loads live from your MyTrack server — same account as the website.</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  hero: { paddingTop: 20, paddingBottom: 26, paddingHorizontal: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start' },
  greet: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  name: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 2 },
  email: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 3 },
  logoutBtn: { width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80' },
  statusText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  body: { padding: 18 },
  section: { color: colors.sub, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12, marginLeft: 4 },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tileLabel: { color: colors.text, fontSize: 17, fontWeight: '700' },
  tileHint: { color: colors.muted, fontSize: 13, marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#EEF0FE', borderRadius: radius.lg, padding: 16, marginTop: 24 },
  noteText: { flex: 1, color: colors.sub, fontSize: 13, lineHeight: 19 },
});
