// Thin API client. All network calls to the Worker live here so components
// never touch fetch directly.

const BASE = '/api';

async function request(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    // Session cookie must ride along or the API will never see the user.
    credentials: 'same-origin',
    // Raw-body callers (an uploaded video, a poster frame) pass their own
    // content-type and a pre-serialised body, so neither is touched here.
    headers:
      body instanceof Blob
        ? { 'content-type': body.type || 'application/octet-stream' }
        : body
          ? { 'content-type': 'application/json' }
          : undefined,
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    // Carried through so a caller can tell "that email is not confirmed yet" from
    // "that password is wrong". The two look identical in the message and need
    // different screens: one offers a new link, the other asks for a retry.
    if (data?.needsVerification) err.needsVerification = true;
    if (data?.email) err.email = data.email;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/health'),

  // auth
  me: () => request('/auth/me'),
  // Phone is optional and never verified. Signup does not sign you in: the
  // address has to be confirmed first, so the caller has to handle a response
  // with needsVerification set.
  signup: (email, password, username, phone) =>
    request('/auth/signup', { method: 'POST', body: { email, password, username, phone } }),
  verifyEmail: (token) => request('/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: (email) =>
    request('/auth/resend-verification', { method: 'POST', body: { email } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  updateProfile: (payload) => request('/auth/profile', { method: 'PUT', body: payload }),

  // Self-service account deletion. Reclaimable for a week by signing in again.
  deleteOwnAccount: (password) =>
    request('/auth/delete-account', { method: 'POST', body: { password } }),
  restoreOwnAccount: () => request('/auth/restore-account', { method: 'POST' }),
  deletionStatus: () => request('/auth/deletion-status'),

  // catalog
  listTitles: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const q = qs.toString();
    return request(`/titles${q ? `?${q}` : ''}`);
  },
  getTitle: (slug) => request(`/titles/${encodeURIComponent(slug)}`),

  // admin catalog CRUD
  createTitle: (payload) => request('/titles', { method: 'POST', body: payload }),
  updateTitle: (slug, payload) =>
    request(`/titles/${encodeURIComponent(slug)}`, { method: 'PUT', body: payload }),
  deleteTitle: (slug) => request(`/titles/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
  listTitlesAdmin: () => request('/titles/staff'),
  // Resolves a TMDB or IMDb id to catalog metadata, server-side.
  tmdbLookup: (id, region) => request('/tmdb/lookup', { method: 'POST', body: { id, region } }),
    // Re-read where an already-posted title can be watched.
    tmdbProviders: (slug, region) => request('/tmdb/providers', { method: 'POST', body: { slug, region } }),
  // Demo catalog: playable public-domain films from the Internet Archive.
  archiveLookup: (payload) => request('/archive/lookup', { method: 'POST', body: payload }),
  // Pasted embed snippet or share link -> provider, id and a rebuilt player URL.
  embedLookup: (url) => request('/embed/lookup', { method: 'POST', body: { url } }),
  // Posts a whole series from a pasted list of episode links.
  importSeries: (payload) => request('/titles/import-series', { method: 'POST', body: payload }),

  // Uploads. The file goes up as a raw request body rather than JSON, so this
  // uses XMLHttpRequest directly: it is the only way to get upload progress.
  listMyUploads: () => request('/uploads'),
  // The pre-roll pool. Public: a pre-roll plays to everyone.
  listAds: () => request('/ads'),
  finaliseUpload: (id, meta) =>
    request(`/uploads/${encodeURIComponent(id)}/finalise`, { method: 'POST', body: meta }),
  // The poster frame the browser captured from the local file. Raw body, like
  // the video, so it is sent straight through without a multipart envelope.
  uploadPoster: (id, blob) =>
    request(`/uploads/${encodeURIComponent(id)}/poster`, {
      method: 'POST',
      body: blob,
      headers: { 'content-type': blob.type || 'image/jpeg' },
    }),
  deleteUpload: (id) => request(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // admin user management
  dashboard: () => request('/admin/dashboard'),
  // scope: 'members' | 'staff' | 'all'. The console has a tab per group, so it
  // asks for one slice rather than filtering a combined list itself.
  listUsers: (scope = 'all') => request(`/admin/users?scope=${encodeURIComponent(scope)}`),
  createUser: (payload) => request('/admin/users', { method: 'POST', body: payload }),
  setUserRole: (id, role) =>
    request(`/admin/users/${encodeURIComponent(id)}/role`, { method: 'POST', body: { role } }),
  // Reset a password. Omit `chosen` to have one generated and returned once;
  // pass `chosen` when you already know the password and want to set it, which
  // is the path for provisioning an account you can sign into yourself.
  resetUserPassword: (id, chosen) =>
    request(`/admin/users/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: chosen ? { password: chosen } : undefined,
    }),
  sendUserResetLink: (id) =>
    request(`/admin/users/${encodeURIComponent(id)}/reset-link`, { method: 'POST' }),
  deleteUser: (id) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // Granting permissions, owner only. The full set is sent each time.
  setUserPermissions: (id, permissions) =>
    request(`/admin/users/${encodeURIComponent(id)}/permissions`, {
      method: 'POST',
      body: { permissions },
    }),
  listDeletedUsers: () => request('/admin/users/deleted'),
  restoreUser: (id) =>
    request(`/admin/users/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  purgeUser: (id) => request(`/admin/users/${encodeURIComponent(id)}/purge`, { method: 'POST' }),

  // announcements
  listAnnouncements: () => request('/announcements'),
  listStaffAnnouncements: () => request('/announcements/staff'),
  createAnnouncement: (payload) => request('/announcements/staff', { method: 'POST', body: payload }),
  updateAnnouncement: (id, payload) =>
    request(`/announcements/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
  deleteAnnouncement: (id) => request(`/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // manual targeted notifications
  sendNotification: (payload) => request('/admin/send', { method: 'POST', body: payload }),

  // staff settings
  getSettings: () => request('/settings'),
  updateSettings: (payload) => request('/settings', { method: 'PUT', body: payload }),

  // notifications
  listNotifications: () => request('/notifications'),
  markNotificationRead: (id) =>
    request(`/notifications/${encodeURIComponent(id)}`, { method: 'POST' }),
  // scope: 'normal' | 'tickets' | 'all'. The bell has two tabs and each clears
  // only its own, so marking "all" has to be an explicit choice rather than what
  // the button next to each tab happens to do.
  markAllNotificationsRead: (scope = 'all') =>
    request(`/notifications?scope=${encodeURIComponent(scope)}`, { method: 'POST' }),

  // Support tickets. One set of routes for both sides: the API returns a member's
  // own tickets and staff see the queue, decided from the session.
  listTickets: (status) =>
    request(`/tickets${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`),
  getTicket: (id) => request(`/tickets/${encodeURIComponent(id)}`),
  createTicket: (payload) => request('/tickets', { method: 'POST', body: payload }),
  replyTicket: (id, message) =>
    request(`/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { message } }),
  acceptTicket: (id) => request(`/tickets/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  // Staff bringing a closed ticket back. Deliberately separate from the member's
  // reopen request: asking is the member's action, doing it is staff's.
  reopenTicket: (id) => request(`/tickets/${encodeURIComponent(id)}/reopen`, { method: 'POST' }),
  requestTicketReopen: (id, note) =>
    request(`/tickets/${encodeURIComponent(id)}/reopen-request`, {
      method: 'POST',
      body: { note },
    }),
  closeTicket: (id) => request(`/tickets/${encodeURIComponent(id)}/close`, { method: 'POST' }),

  // self-service reset
  requestPasswordReset: (email) =>
    request('/auth/request-reset', { method: 'POST', body: { email } }),
  resetPassword: (token, password) =>
    request('/auth/reset-password', { method: 'POST', body: { token, password } }),

  // watchlist
  watchlist: () => request('/watchlist'),
  addWatchlist: (slug) => request('/watchlist', { method: 'POST', body: { slug } }),
  removeWatchlist: (slug) =>
    request(`/watchlist/${encodeURIComponent(slug)}`, { method: 'DELETE' }),

  // playback
  startPlayback: (slug, position, device = 'web') =>
    request('/playback/start', { method: 'POST', body: { slug, position, device } }),
  continueWatching: () => request('/playback/continue'),
};