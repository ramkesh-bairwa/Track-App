import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Header from '../Header';
import { colors } from '../theme';
import { Card, Empty, ErrorView, Loading } from '../ui';
import { api } from '../api';

export default function TrackDetailScreen({ params, nav, canGoBack }) {
  const { id, name } = params || {};
  const [state, setState] = useState({ loading: true, error: '', entries: [], columns: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [entriesRes, colsRes] = await Promise.all([
        api.get(`/api/tracks/${id}/entries`),
        api.get(`/api/tracks/${id}/columns`).catch(() => ({ columns: [] })),
      ]);
      const entries = (entriesRes.entries || []).map((e) => ({
        ...e,
        data: typeof e.data === 'string' ? safeParse(e.data) : e.data || {},
      }));
      setState({ loading: false, error: '', entries, columns: colsRes.columns || [] });
    } catch (e) {
      setState({ loading: false, error: e.message, entries: [], columns: [] });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const labelCols = state.columns.slice(0, 4);

  return (
    <View style={{ flex: 1 }}>
      <Header title={name || 'Track'} canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading records…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.entries.length === 0 ? (
        <Empty message="No records in this track yet." />
      ) : (
        <FlatList
          data={state.entries}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={<Text style={s.count}>{state.entries.length} record{state.entries.length === 1 ? '' : 's'}</Text>}
          renderItem={({ item }) => (
            <Card>
              {labelCols.length > 0 ? (
                labelCols.map((col) => (
                  <View key={col.id || col.field_key} style={s.field}>
                    <Text style={s.fieldLabel}>{col.name || col.field_key}</Text>
                    <Text style={s.fieldValue}>{formatVal(item.data?.[col.field_key])}</Text>
                  </View>
                ))
              ) : (
                Object.entries(item.data || {}).slice(0, 4).map(([k, v]) => (
                  <View key={k} style={s.field}>
                    <Text style={s.fieldLabel}>{k}</Text>
                    <Text style={s.fieldValue}>{formatVal(v)}</Text>
                  </View>
                ))
              )}
            </Card>
          )}
        />
      )}
    </View>
  );
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
function formatVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const s = StyleSheet.create({
  count: { color: colors.muted, fontSize: 13, marginBottom: 2 },
  field: { marginBottom: 8 },
  fieldLabel: { color: colors.muted, fontSize: 12 },
  fieldValue: { color: colors.text, fontSize: 15, marginTop: 1 },
});
