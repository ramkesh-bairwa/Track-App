import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../Header';
import { colors, radius } from '../theme';
import { Card, Empty, ErrorView, Loading } from '../ui';
import { api } from '../api';

export default function TracksScreen({ nav, canGoBack }) {
  const [state, setState] = useState({ loading: true, error: '', tracks: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/tracks');
      setState({ loading: false, error: '', tracks: (data.tracks || []).filter((t) => t.parent_id == null) });
    } catch (e) {
      setState({ loading: false, error: e.message, tracks: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Tracks" subtitle={state.tracks.length ? `${state.tracks.length} trackers` : undefined} canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading tracks…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.tracks.length === 0 ? (
        <Empty icon="albums-outline" title="No tracks yet" subtitle="Create a tracker on the web and it'll show up here." />
      ) : (
        <FlatList
          data={state.tracks}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Card onPress={() => nav.navigate('TrackDetail', { id: item.id, name: item.name })}>
              <View style={s.row}>
                <View style={[s.accent, { backgroundColor: item.color || colors.primary }]}>
                  <Ionicons name="pricetag" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.meta} numberOfLines={1}>
                    {item.description ? item.description : `${item.entry_count ?? 0} record${(item.entry_count ?? 0) === 1 ? '' : 's'}`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  accent: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
