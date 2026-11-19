import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Header from '../Header';
import { colors } from '../theme';
import { Card, Empty, ErrorView, Loading } from '../ui';
import { api } from '../api';

export default function TracksScreen({ nav, canGoBack }) {
  const [state, setState] = useState({ loading: true, error: '', tracks: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/tracks');
      setState({ loading: false, error: '', tracks: data.tracks || [] });
    } catch (e) {
      setState({ loading: false, error: e.message, tracks: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <Header title="Tracks" canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading tracks…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.tracks.length === 0 ? (
        <Empty message="No tracks yet." />
      ) : (
        <FlatList
          data={state.tracks}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Card onPress={() => nav.navigate('TrackDetail', { id: item.id, name: item.name })}>
              <View style={s.row}>
                <View style={[s.dot, { backgroundColor: item.color || colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.name}</Text>
                  {item.description ? <Text style={s.desc} numberOfLines={1}>{item.description}</Text> : null}
                </View>
                <Text style={s.chev}>›</Text>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  desc: { color: colors.muted, fontSize: 13, marginTop: 2 },
  chev: { color: colors.muted, fontSize: 24 },
});
