import { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View } from 'react-native';
import { colors } from './src/theme';
import { Loading } from './src/ui';
import { setApiToken, fetchMe } from './src/api';
import { loadSession, saveSession, clearSession } from './src/storage';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import TracksScreen from './src/screens/TracksScreen';
import TrackDetailScreen from './src/screens/TrackDetailScreen';
import TasksScreen from './src/screens/TasksScreen';
import NotesScreen from './src/screens/NotesScreen';

const SCREENS = {
  Home: HomeScreen,
  Tracks: TracksScreen,
  TrackDetail: TrackDetailScreen,
  Tasks: TasksScreen,
  Notes: NotesScreen,
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [stack, setStack] = useState([{ name: 'Home', params: {} }]);

  // Restore a saved session on launch and confirm it's still valid.
  useEffect(() => {
    (async () => {
      const s = await loadSession();
      if (s.token) {
        setApiToken(s.token);
        try {
          const me = await fetchMe(s.token);
          setToken(s.token);
          setUser(me.user || s.user);
        } catch {
          await clearSession();
          setApiToken(null);
        }
      }
      setBooting(false);
    })();
  }, []);

  const signIn = useCallback(async (newToken, newUser) => {
    setApiToken(newToken);
    await saveSession(newToken, newUser);
    setToken(newToken);
    setUser(newUser);
    setStack([{ name: 'Home', params: {} }]);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setApiToken(null);
    setToken(null);
    setUser(null);
    setStack([{ name: 'Home', params: {} }]);
  }, []);

  const nav = useMemo(
    () => ({
      navigate: (name, params = {}) => setStack((st) => [...st, { name, params }]),
      goBack: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
      reset: (name = 'Home', params = {}) => setStack([{ name, params }]),
    }),
    []
  );

  if (booting) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" />
        <Loading label="MyTrack" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" />
      <View style={s.body}>
        {!token ? (
          <LoginScreen onSignedIn={signIn} />
        ) : (
          (() => {
            const current = stack[stack.length - 1];
            const Screen = SCREENS[current.name] || HomeScreen;
            return (
              <Screen
                params={current.params}
                nav={nav}
                auth={{ user, token, signOut }}
                canGoBack={stack.length > 1}
              />
            );
          })()
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
