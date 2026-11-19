import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Header from '../Header';
import { colors, radius } from '../theme';
import { Card, Empty, ErrorView, Loading } from '../ui';
import { api } from '../api';

const ACCENTS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9', '#8B5CF6'];

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
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const snippet = (n) => String(n.preview || n.body || n.content || n.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Notes" subtitle={state.notes.length ? `${state.notes.length} notes` : undefined} canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading notes…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.notes.length === 0 ? (
        <Empty icon="document-text-outline" title="No notes yet" subtitle="Notes you write on the web show up here." />
      ) : (
        <FlatList
          data={state.notes}
          keyExtractor={(n) => String(n.id || n.uuid)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item, index }) => (
            <Card>
              <View style={s.row}>
                <View style={[s.bar, { backgroundColor: ACCENTS[index % ACCENTS.length] }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                  {snippet(item) ? <Text style={s.body} numberOfLines={2}>{snippet(item)}</Text> : null}
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  bar: { width: 4, borderRadius: radius.pill, alignSelf: 'stretch' },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 13, marginTop: 5, lineHeight: 19 },
});
