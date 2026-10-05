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
  // Greeting for the next render after sign-in. Lives in state, not storage:
  // a banner that polls sessionStorage on mount runs once at app start and
  // misses the value login writes moments later.
  const [greeting, setGreeting] = useState(null);

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
    // Signing in is also how a deleted account is restored, so the caller needs
    // to be able to say so rather than just landing on the home page.
    setGreeting({
      name: preferredName(d.user),
      restored: Boolean(d.restored),
    });
    return d.user;
  }, []);

  const signup = useCallback(async (email, password, username) => {
    const d = await api.signup(email, password, username);
    setUser(d.user);
    setGreeting({ name: preferredName(d.user), fresh: true });
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    setGreeting(null);
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  const dismissGreeting = useCallback(() => setGreeting(null), []);

  /**
   * Re-reads the session.
   *
   * Needed after anything that changes the account's own state, such as
   * restoring a pending deletion: the cookie is unchanged by those calls, so
   * nothing else would tell the app the user is signed in again.
   */
  const refresh = useCallback(async () => {
    const d = await api.me().catch(() => ({ user: null }));
    setUser(d.user);
    return d.user;
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, signup, logout, greeting, dismissGreeting, refresh }),
    [user, ready, login, signup, logout, greeting, dismissGreeting, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}