import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Header from '../Header';
import { colors } from '../theme';
import { Card, Empty, ErrorView, Loading } from '../ui';
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <Header title="Task boards" canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading boards…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.boards.length === 0 ? (
        <Empty message="No task boards yet." />
      ) : (
        <FlatList
          data={state.boards}
          keyExtractor={(b) => String(b.id || b.uuid)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <Card>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.meta}>
                {(item.taskCount ?? item.task_count ?? item.tasks ?? 0)} tasks
                {item.role ? ` · ${item.role}` : ''}
              </Text>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 3 },
});
