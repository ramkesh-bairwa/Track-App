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

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const labelCols = state.columns.slice(0, 5);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={name || 'Track'} subtitle={state.entries.length ? `${state.entries.length} records` : undefined} canGoBack={canGoBack} onBack={nav.goBack} />
      {state.loading ? (
        <Loading label="Loading records…" />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={load} />
      ) : state.entries.length === 0 ? (
        <Empty icon="file-tray-outline" title="No records yet" subtitle="Records you add on the web appear here." />
      ) : (
        <FlatList
          data={state.entries}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item, index }) => {
            const pairs = labelCols.length
              ? labelCols.map((c) => [c.name || c.field_key, item.data?.[c.field_key]])
              : Object.entries(item.data || {}).slice(0, 5);
            return (
              <Card>
                <Text style={s.recNo}>#{state.entries.length - index}</Text>
                {pairs.map(([k, v], i) => (
                  <View key={i} style={[s.field, i === pairs.length - 1 && { marginBottom: 0 }]}>
                    <Text style={s.label}>{k}</Text>
                    <Text style={s.value}>{formatVal(v)}</Text>
                  </View>
                ))}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
function formatVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const s = StyleSheet.create({
  recNo: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 10 },
  field: { marginBottom: 10 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  value: { color: colors.text, fontSize: 15, marginTop: 2 },
});
