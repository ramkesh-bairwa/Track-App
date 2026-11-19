import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, gradients, radius, shadow } from '../theme';
import { Button } from '../ui';
import { login, fetchMe, setApiToken } from '../api';
import { API_BASE } from '../config';

export default function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState('');

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
        user = (await fetchMe(res.token)).user;
      } catch {}
      await onSignedIn(res.token, user);
    } catch (e) {
      setError(e.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  const inputWrap = (name) => [s.inputWrap, focus === name && s.inputWrapFocus];

  return (
    <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={s.hero}>
            <View style={s.logoMark}>
              <Ionicons name="pulse" size={34} color="#fff" />
            </View>
            <Text style={s.brand}>MyTrack</Text>
            <Text style={s.tagline}>Track everything, in one place.</Text>
          </View>

          <View style={[s.card, shadow(3)]}>
            <Text style={s.cardTitle}>Welcome back</Text>
            <Text style={s.cardSub}>Sign in to continue</Text>

            <View style={inputWrap('email')}>
              <Ionicons name="mail-outline" size={20} color={colors.muted} />
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocus('email')}
                onBlur={() => setFocus('')}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                placeholder="Email address"
                placeholderTextColor={colors.muted}
              />
            </View>

            <View style={inputWrap('password')}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocus('password')}
                onBlur={() => setFocus('')}
                secureTextEntry={!show}
                placeholder="Password"
                placeholderTextColor={colors.muted}
                onSubmitEditing={submit}
              />
              <Pressable onPress={() => setShow((v) => !v)} hitSlop={10}>
                <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
              </Pressable>
            </View>

            {error ? (
              <View style={s.errorBox}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={{ height: 6 }} />
            <Button title={busy ? 'Signing in…' : 'Sign in'} icon={busy ? undefined : 'arrow-forward'} onPress={submit} loading={busy} />
          </View>

          <Text style={s.server}>
            <Ionicons name="shield-checkmark-outline" size={12} color="rgba(255,255,255,0.8)" /> {API_BASE.replace(/^https?:\/\//, '')}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingVertical: 48 },
  hero: { alignItems: 'center', marginBottom: 28 },
  logoMark: {
    width: 76, height: 76, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  brand: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 16, letterSpacing: 0.3 },
  tagline: { color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: 24 },
  cardTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  cardSub: { color: colors.muted, fontSize: 15, marginTop: 2, marginBottom: 20 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, paddingHorizontal: 14, marginBottom: 14,
  },
  inputWrapFocus: { borderColor: colors.primary, backgroundColor: '#fff' },
  input: { flex: 1, paddingVertical: 15, color: colors.text, fontSize: 16 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FDEBEF', padding: 10, borderRadius: radius.sm, marginTop: 2 },
  errorText: { color: colors.danger, fontSize: 14, flex: 1 },
  server: { color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'center', marginTop: 24 },
});
