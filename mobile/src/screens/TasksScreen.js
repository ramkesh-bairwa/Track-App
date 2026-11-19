import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Header from '../Header';
import { colors } from '../theme';
import { Badge, Card, Empty, ErrorView, IconTile, Loading } from '../ui';
import { api } from '../api';

export default function TasksScreen({ nav, canGoBack }) {
  const [state, setState] = useState({ loading: true, error: '', boards: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/task-boards');
      setState({ loading: false, error: '', boards: data.boards || [] });
    } catch (e) {
      setState({ loading: false, error: e.message, boards: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Task boards" subtitle={state.boards.length ? `${state.boards.length} boards` : undefined} canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading boards…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.boards.length === 0 ? (
        <Empty icon="checkbox-outline" title="No task boards yet" subtitle="Create a board on the web to see it here." />
      ) : (
        <FlatList
          data={state.boards}
          keyExtractor={(b) => String(b.id || b.uuid)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Card>
              <View style={s.row}>
                <IconTile icon="clipboard-outline" tint="emerald" />
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.meta}>{item.taskCount ?? item.task_count ?? item.tasks ?? 0} tasks</Text>
                </View>
                {item.role ? <Badge label={item.role} tint="slate" /> : null}
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
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
