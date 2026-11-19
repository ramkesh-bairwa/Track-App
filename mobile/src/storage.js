import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'mytrack_token';
const USER_KEY = 'mytrack_user';

export async function saveSession(token, user) {
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token || '');
    if (user) await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {}
}

export async function loadSession() {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const rawUser = await AsyncStorage.getItem(USER_KEY);
    return { token: token || null, user: rawUser ? JSON.parse(rawUser) : null };
  } catch {
    return { token: null, user: null };
  }
}

export async function clearSession() {
  try {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  } catch {}
}
