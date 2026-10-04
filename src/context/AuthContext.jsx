import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

/** Display name preference: chosen name, then username, then email local-part. */
export function preferredName(user) {
  if (!user) return '';
  if (user.displayName) return user.displayName;
  if (user.username) return user.username;
  const local = String(user.email || '').split('@')[0];
  return local || 'friend';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Restore the session on load so a refresh doesn't log you out.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((d) => {
        if (!cancelled) setUser(d.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api.login(email, password);
    setUser(d.user);
    // Consumed once by the shell to show the welcome-back greeting.
    sessionStorage.setItem('animeta:justLoggedIn', JSON.stringify({ name: preferredName(d.user) }));
    return d.user;
  }, []);

  const signup = useCallback(async (email, password, username) => {
    const d = await api.signup(email, password, username);
    setUser(d.user);
    sessionStorage.setItem('animeta:justLoggedIn', JSON.stringify({ name: preferredName(d.user), fresh: true }));
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    sessionStorage.removeItem('animeta:justLoggedIn');
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, signup, logout }), [user, ready, login, signup, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}