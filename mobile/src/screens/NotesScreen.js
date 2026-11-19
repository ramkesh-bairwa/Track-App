import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Header from '../Header';
import { colors } from '../theme';
import { Card, Empty, ErrorView, Loading } from '../ui';
import { api } from '../api';

export default function NotesScreen({ nav, canGoBack }) {
  const [state, setState] = useState({ loading: true, error: '', notes: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/notes');
      setState({ loading: false, error: '', notes: data.notes || [] });
    } catch (e) {
      setState({ loading: false, error: e.message, notes: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const snippet = (n) => {
    const raw = n.preview || n.body || n.content || n.text || '';
    return String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Notes" canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading notes…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.notes.length === 0 ? (
        <Empty message="No notes yet." />
      ) : (
        <FlatList
          data={state.notes}
          keyExtractor={(n) => String(n.id || n.uuid)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Card>
              <Text style={s.title}>{item.title || 'Untitled'}</Text>
              {snippet(item) ? <Text style={s.body} numberOfLines={2}>{snippet(item)}</Text> : null}
            </Card>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
});
