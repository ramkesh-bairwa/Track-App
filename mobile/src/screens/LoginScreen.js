import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { Button } from '../ui';
import { login, fetchMe, setApiToken } from '../api';
import { API_BASE } from '../config';

export default function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await login(email.trim().toLowerCase(), password);
      if (!res?.token) throw new Error('No token returned by the server.');
      setApiToken(res.token);
      let user = null;
      try {
        const me = await fetchMe(res.token);
        user = me.user;
      } catch {}
      await onSignedIn(res.token, user);
    } catch (e) {
      setError(e.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.logo}>MyTrack</Text>
        <Text style={s.sub}>Sign in to your account</Text>

        <View style={s.form}>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
          />
          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
            onSubmitEditing={submit}
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={{ height: 8 }} />
          <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={busy} />
        </View>

        <Text style={s.server}>Server: {API_BASE.replace(/^https?:\/\//, '')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 6 },
  logo: { color: colors.primary, fontSize: 40, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.muted, fontSize: 16, textAlign: 'center', marginBottom: 24 },
  form: { gap: 8 },
  label: { color: colors.muted, fontSize: 13, marginTop: 8 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.danger, marginTop: 10 },
  server: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 28 },
});
