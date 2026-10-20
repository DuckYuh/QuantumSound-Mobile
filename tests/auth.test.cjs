const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AxiosError, isCancel } = require('axios');
const { QueryClient } = require('@tanstack/react-query');
const { AuthSession } = require('../src/features/auth/session.ts');
const { AuthError } = require('../src/features/auth/error.ts');
const { ApiError } = require('../src/api/error.ts');
const { TokenStorageError } = require('../src/services/token-storage-error.ts');
const { createHttpClient } = require('../src/api/http-client.ts');
const { createAuthApi } = require('../src/api/auth.ts');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(name = 'a', version = 1) {
  return {
    access_token: `access-${name}-${version}`,
    refresh_token: `refresh-${name}-${version}`,
    session_id: `session-${name}-${version}`,
    user: { id: name, username: name, email: `${name}@example.test`, displayName: name, role: 'USER' },
  };
}
function profile(name = 'a') {
  return { ...response(name).user, avatar: null, bio: null, country: null, status: 'ACTIVE', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
}
const unauthorized = () => new ApiError('Unauthorized', 401, 'ERR_BAD_REQUEST', []);
const offline = () => new ApiError('Offline', undefined, 'ERR_NETWORK', []);
const kind = expected => error => error instanceof AuthError && error.kind === expected;

function setup(saved = null) {
  const calls = { refresh: 0, read: 0, write: 0, delete: 0, logout: [], clear: 0 };
  let disk = saved;
  const storage = {
    getRefreshToken: async () => { calls.read++; return disk; },
    setRefreshToken: async value => { calls.write++; disk = value; },
    deleteRefreshToken: async () => { calls.delete++; disk = null; },
  };
  const api = {
    login: async () => response(),
    register: async () => response(),
    refresh: async () => { calls.refresh++; return response('a', 2); },
    currentUser: async () => profile(),
    logout: async token => { calls.logout.push(token); },
  };
  const session = new AuthSession(api, storage);
  session.bindCache(() => calls.clear++);
  return { api, storage, session, calls, disk: () => disk };
}

function httpHarness() {
  const h = setup();
  const http = createHttpClient('https://api.example.test', () => h.session);
  const calls = [];
  const reply = (config, data = {}, status = 200) => {
    const result = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, result);
    return result;
  };
  let handler = async config => {
    if (config.url === '/auth/login' || config.url === '/auth/register') return reply(config, response());
    if (config.url === '/auth/refresh') return reply(config, response('a', 2));
    if (config.url === '/auth/logout') return reply(config, { message: 'Logged out successfully' });
    return reply(config, { token: config.headers.get('Authorization') });
  };
  http.defaults.adapter = async config => { calls.push(config); return handler(config); };
  Object.assign(h.api, createAuthApi(http));
  return { ...h, http, requests: calls, reply, handle: fn => { handler = fn; } };
}

test('anonymous startup is idempotent under effect replay', async () => {
  const h = setup();
  assert.equal(h.session.getSnapshot().status, 'initializing');
  const first = h.session.start();
  assert.equal(first, h.session.start());
  await first;
  assert.deepEqual(h.session.getSnapshot(), { status: 'unauthenticated', user: null, error: null });
  assert.equal(h.calls.read, 1);
  assert.equal(h.calls.refresh, 0);
});

test('startup persists rotation before exposing authenticated state', async () => {
  const h = setup('refresh-a-1');
  const gate = deferred();
  const original = h.storage.setRefreshToken;
  h.storage.setRefreshToken = async token => { await gate.promise; await original(token); };
  const start = h.session.start();
  await tick();
  assert.equal(h.session.getCredentials().token, null);
  assert.equal(h.session.getSnapshot().status, 'initializing');
  gate.resolve();
  await start;
  assert.equal(h.disk(), 'refresh-a-2');
  assert.equal(h.session.getSnapshot().user.id, 'a');
  assert.equal(h.session.getCredentials().token, 'access-a-2');
});

test('login and registration use actual DTOs; exchanges never attach bearer tokens', async () => {
  const h = httpHarness();
  h.handle(async config => h.reply(config, response(config.url === '/auth/register' ? 'b' : 'a')));
  await h.session.login({ email: 'a@example.test', password: 'password123' });
  await h.session.register({ username: 'b', displayName: 'B', email: 'b@example.test', password: 'password123' });
  const registration = h.requests.find(config => config.url === '/auth/register');
  assert.deepEqual(JSON.parse(registration.data), { username: 'b', displayName: 'B', email: 'b@example.test', password: 'password123' });
  assert.ok(h.requests.every(config => !config.headers.has('Authorization')));
  assert.equal(h.disk(), 'refresh-b-1');
});

test('bad login is distinguished from session expiry and never refreshes', async () => {
  const h = httpHarness();
  h.handle(async config => h.reply(config, { message: 'Invalid credentials' }, 401));
  await assert.rejects(h.session.login({ email: 'a', password: 'bad' }), kind('invalid-credentials'));
  assert.equal(h.requests.length, 1);
  assert.equal(h.disk(), null);
});

test('registration conflict is a request error, not invalid credentials', async () => {
  const h = setup();
  h.api.register = async () => { throw new ApiError('Email already exists', 400, undefined, []); };
  await assert.rejects(h.session.register({}), kind('request'));
});

test('concurrent refreshes share the same rotation promise', async () => {
  const h = setup();
  await h.session.login({});
  const gate = deferred();
  h.api.refresh = async () => { h.calls.refresh++; return gate.promise; };
  const first = h.session.refresh();
  const second = h.session.refresh();
  assert.equal(first, second);
  gate.resolve(response('a', 2));
  await Promise.all([first, second]);
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.disk(), 'refresh-a-2');
});

test('offline startup preserves disk credentials and allows explicit recovery', async () => {
  const h = setup('refresh-a-1');
  h.api.refresh = async () => { throw offline(); };
  await assert.rejects(h.session.start(), kind('network'));
  assert.equal(h.disk(), 'refresh-a-1');
  assert.equal(h.calls.delete, 0);
  assert.equal(h.session.getSnapshot().error.kind, 'network');
  h.api.refresh = async () => response('a', 2);
  await h.session.restore();
  assert.equal(h.session.getSnapshot().status, 'authenticated');
});

test('temporary refresh failure keeps the authenticated session and refresh token', async () => {
  const h = setup();
  await h.session.login({});
  h.api.refresh = async () => { throw offline(); };
  await assert.rejects(h.session.refresh(), kind('network'));
  assert.equal(h.session.getSnapshot().status, 'authenticated');
  assert.equal(h.disk(), 'refresh-a-1');
});

test('invalid refresh clears credentials and private cache', async () => {
  const h = setup('expired');
  h.api.refresh = async () => { throw unauthorized(); };
  await h.session.start();
  assert.equal(h.disk(), null);
  assert.equal(h.session.getCredentials().token, null);
  assert.equal(h.session.getSnapshot().error.kind, 'session-expired');
  assert.equal(h.calls.clear, 1);
});

test('SecureStore read failures are explicit and do not delete credentials', async () => {
  const h = setup('saved');
  h.storage.getRefreshToken = async () => { throw new TokenStorageError('read'); };
  await assert.rejects(h.session.start(), kind('storage'));
  assert.equal(h.disk(), 'saved');
  assert.equal(h.calls.delete, 0);
});

test('failed rotation persistence retains the replacement for a write-only recovery', async () => {
  const h = setup('refresh-a-1');
  const original = h.storage.setRefreshToken;
  h.storage.setRefreshToken = async () => { throw new TokenStorageError('write'); };
  await assert.rejects(h.session.start(), kind('storage'));
  assert.equal(h.session.getCredentials().token, null);
  assert.equal(h.disk(), 'refresh-a-1');
  h.storage.setRefreshToken = original;
  await h.session.restore();
  assert.equal(h.calls.refresh, 1);
  assert.equal(h.disk(), 'refresh-a-2');
  assert.equal(h.session.getSnapshot().status, 'authenticated');
});

test('logout during refresh cannot resurrect a session and revokes a late replacement', async () => {
  const h = setup();
  await h.session.login({});
  const gate = deferred();
  h.api.refresh = () => gate.promise;
  const pending = h.session.refresh();
  const rejected = assert.rejects(pending, kind('superseded'));
  await tick();
  await h.session.logout();
  gate.resolve(response('a', 2));
  await rejected;
  assert.equal(h.disk(), null);
  assert.equal(h.session.getSnapshot().status, 'unauthenticated');
  assert.ok(h.calls.logout.includes('refresh-a-2'));
});

test('latest account wins when an older login completes last', async () => {
  const h = setup();
  const gate = deferred();
  h.api.login = input => input.email === 'a' ? gate.promise : Promise.resolve(response('b'));
  const old = h.session.login({ email: 'a' });
  const rejected = assert.rejects(old, kind('superseded'));
  await tick();
  await h.session.login({ email: 'b' });
  gate.resolve(response('a'));
  await rejected;
  assert.equal(h.disk(), 'refresh-b-1');
  assert.equal(h.session.getSnapshot().user.id, 'b');
  assert.ok(h.calls.logout.includes('refresh-a-1'));
});

test('logout deletion is ordered after an in-flight credential write', async () => {
  const h = setup();
  const gate = deferred();
  const original = h.storage.setRefreshToken;
  h.storage.setRefreshToken = async token => { await gate.promise; await original(token); };
  const login = h.session.login({});
  const rejected = assert.rejects(login, kind('superseded'));
  await tick();
  const logout = h.session.logout();
  assert.equal(h.session.getSnapshot().status, 'unauthenticated');
  gate.resolve();
  await Promise.all([rejected, logout]);
  assert.equal(h.disk(), null);
});

test('failed logout deletion clears memory/cache and blocks restoration until cleanup', async () => {
  const h = setup();
  await h.session.login({});
  const original = h.storage.deleteRefreshToken;
  h.storage.deleteRefreshToken = async () => { throw new TokenStorageError('delete'); };
  await assert.rejects(h.session.logout(), kind('storage'));
  assert.equal(h.session.getCredentials().token, null);
  assert.equal(h.session.getSnapshot().user, null);
  await assert.rejects(h.session.restore(), kind('storage'));
  h.storage.deleteRefreshToken = original;
  await h.session.logout();
  assert.equal(h.disk(), null);
});

test('offline remote logout still clears local credentials', async () => {
  const h = setup();
  await h.session.login({});
  h.api.logout = async () => { throw offline(); };
  await assert.rejects(h.session.logout(), kind('network'));
  assert.equal(h.disk(), null);
  assert.equal(h.session.getSnapshot().status, 'unauthenticated');
});

test('slow startup storage read cannot overwrite a subsequent login', async () => {
  const h = setup('old');
  const gate = deferred();
  h.storage.getRefreshToken = () => gate.promise;
  const start = h.session.start();
  const rejected = assert.rejects(start, kind('superseded'));
  await tick();
  h.api.login = async () => response('b');
  const login = h.session.login({});
  gate.resolve('old');
  await Promise.all([rejected, login]);
  assert.equal(h.session.getSnapshot().user.id, 'b');
  assert.equal(h.disk(), 'refresh-b-1');
});

test('stale profile responses cannot replace the current account', async () => {
  const h = setup();
  await h.session.login({});
  const gate = deferred();
  h.api.currentUser = () => gate.promise;
  const old = h.session.refreshUser();
  const rejected = assert.rejects(old, kind('superseded'));
  h.api.login = async () => response('b');
  await h.session.login({});
  gate.resolve(profile('a'));
  await rejected;
  assert.equal(h.session.getSnapshot().user.id, 'b');
});

test('actual QueryClient cache is cleared on switching accounts and logout', async () => {
  const h = setup();
  const query = new QueryClient();
  h.session.bindCache(() => query.clear());
  query.setQueryData(['library', 'old-account'], ['private']);
  await h.session.login({});
  assert.equal(query.getQueryCache().getAll().length, 0);
  query.setQueryData(['me'], profile());
  await h.session.logout();
  assert.equal(query.getQueryCache().getAll().length, 0);
});

test('many Axios 401s perform one refresh and replay each request once', async () => {
  const h = httpHarness();
  await h.session.login({});
  const gate = deferred();
  h.handle(async config => {
    if (config.url === '/auth/refresh') { await gate.promise; return h.reply(config, response('a', 2)); }
    if (config.headers.get('Authorization') === 'Bearer access-a-1') return h.reply(config, {}, 401);
    return h.reply(config, { ok: true });
  });
  const jobs = Array.from({ length: 8 }, () => h.http.get('/private'));
  await tick();
  gate.resolve();
  const results = await Promise.all(jobs);
  assert.ok(results.every(result => result.data.ok));
  assert.equal(h.requests.filter(config => config.url === '/auth/refresh').length, 1);
  assert.equal(h.requests.filter(config => config.url === '/private').length, 16);
});

test('a late 401 reuses an already rotated token instead of refreshing again', async () => {
  const h = httpHarness();
  await h.session.login({});
  const late = deferred();
  h.handle(async config => {
    if (config.url === '/auth/refresh') return h.reply(config, response('a', 2));
    if (config.url === '/late' && config.headers.get('Authorization') === 'Bearer access-a-1') await late.promise;
    if (config.headers.get('Authorization') === 'Bearer access-a-1') return h.reply(config, {}, 401);
    return h.reply(config, {});
  });
  const old = h.http.get('/late');
  await tick();
  await h.http.get('/private');
  late.resolve();
  await old;
  assert.equal(h.requests.filter(config => config.url === '/auth/refresh').length, 1);
});

test('a second 401 invalidates the session with no refresh loop', async () => {
  const h = httpHarness();
  await h.session.login({});
  h.handle(async config => config.url === '/auth/refresh'
    ? h.reply(config, response('a', 2))
    : config.url === '/auth/logout' ? h.reply(config, {}) : h.reply(config, {}, 401));
  await assert.rejects(h.http.get('/private'), kind('session-expired'));
  assert.equal(h.requests.filter(config => config.url === '/private').length, 2);
  assert.equal(h.session.getSnapshot().status, 'unauthenticated');
  assert.equal(h.disk(), null);
});

test('refresh endpoint 401 is terminal and cannot recursively refresh itself', async () => {
  const h = httpHarness();
  await h.session.login({});
  h.handle(async config => config.url === '/auth/logout' ? h.reply(config, {}) : h.reply(config, {}, 401));
  await assert.rejects(h.http.get('/private'), kind('session-expired'));
  assert.equal(h.requests.filter(config => config.url === '/auth/refresh').length, 1);
  assert.equal(h.disk(), null);
});

test('stale successful Axios responses are rejected after logout', async () => {
  const h = httpHarness();
  await h.session.login({});
  const gate = deferred();
  h.handle(async config => {
    if (config.url === '/private') await gate.promise;
    return h.reply(config, { private: true });
  });
  const old = h.http.get('/private');
  const rejected = assert.rejects(old, kind('superseded'));
  await tick();
  await h.session.logout();
  gate.resolve();
  await rejected;
});

test('stale 401s never refresh or invalidate a different account', async () => {
  const h = httpHarness();
  await h.session.login({});
  const gate = deferred();
  h.handle(async config => {
    if (config.url === '/auth/login') return h.reply(config, response('b'));
    if (config.url === '/auth/logout') return h.reply(config, {});
    await gate.promise;
    return h.reply(config, {}, 401);
  });
  const old = h.http.get('/private');
  const rejected = assert.rejects(old, kind('superseded'));
  await tick();
  await h.session.login({});
  gate.resolve();
  await rejected;
  assert.equal(h.session.getSnapshot().user.id, 'b');
  assert.equal(h.requests.filter(config => config.url === '/auth/refresh').length, 0);
});

test('canceling a refresh waiter does not cancel another request or replay the canceled one', async () => {
  const h = httpHarness();
  await h.session.login({});
  const gate = deferred();
  h.handle(async config => {
    if (config.url === '/auth/refresh') { await gate.promise; return h.reply(config, response('a', 2)); }
    if (config.headers.get('Authorization') === 'Bearer access-a-1') return h.reply(config, {}, 401);
    return h.reply(config, {});
  });
  const abort = new AbortController();
  const canceled = h.http.get('/canceled', { signal: abort.signal });
  const rejected = assert.rejects(canceled, isCancel);
  const active = h.http.get('/active');
  await tick();
  abort.abort();
  gate.resolve();
  await Promise.all([rejected, active]);
  assert.equal(h.requests.filter(config => config.url === '/canceled').length, 1);
  assert.equal(h.session.getSnapshot().status, 'authenticated');
});

test('external, anonymous, manual-authorization and opted-out requests do not trigger refresh', async () => {
  const h = httpHarness();
  h.handle(async config => h.reply(config, {}, 401));
  await assert.rejects(h.http.get('/anonymous'));
  await h.session.login({}).catch(() => {});
  // Establish credentials with the isolated lifecycle API for the origin checks.
  h.api.login = async () => response();
  await h.session.login({});
  await assert.rejects(h.http.get('https://outside.test/data'));
  await assert.rejects(h.http.get('/public', { authMode: 'none' }));
  await assert.rejects(h.http.get('/manual', { headers: { Authorization: 'Custom own-credential' } }));
  assert.equal(h.requests.find(config => config.url === 'https://outside.test/data').headers.has('Authorization'), false);
  assert.equal(h.requests.filter(config => config.url === '/auth/refresh').length, 0);
  assert.equal(h.session.getSnapshot().status, 'authenticated');
});

test('malformed auth payloads are rejected before any credentials are stored', async () => {
  const h = httpHarness();
  h.handle(async config => h.reply(config, { access_token: 'access', refresh_token: '', user: response().user }));
  await assert.rejects(h.session.login({}), kind('invalid-response'));
  assert.equal(h.disk(), null);
  assert.equal(h.session.getCredentials().token, null);
});

test('current-user parsing follows the JWT strategy projection and rejects null profiles', async () => {
  const h = httpHarness();
  await h.session.login({});
  h.handle(async config => h.reply(config, profile()));
  await h.session.refreshUser();
  assert.equal(h.session.getSnapshot().user.avatar, null);
  h.handle(async config => h.reply(config, null));
  await assert.rejects(h.session.refreshUser(), kind('invalid-response'));
});

test('inactive canonical users invalidate the local session', async () => {
  const h = setup();
  await h.session.login({});
  h.api.currentUser = async () => ({ ...profile(), status: 'BANNED' });
  await h.session.refreshUser();
  assert.equal(h.session.getSnapshot().status, 'unauthenticated');
  assert.equal(h.disk(), null);
});

test('failed invalid-session cleanup remains a storage error rather than a stale-operation error', async () => {
  const h = setup('invalid');
  h.api.refresh = async () => { throw unauthorized(); };
  h.storage.deleteRefreshToken = async () => { throw new TokenStorageError('delete'); };
  await assert.rejects(h.session.start(), kind('storage'));
  assert.equal(h.session.getSnapshot().error.kind, 'storage');
  assert.equal(h.session.getCredentials().token, null);
});

test('account switching during refresh retires the late token without touching the new account', async () => {
  const h = setup();
  await h.session.login({});
  const gate = deferred();
  h.api.refresh = () => gate.promise;
  const refreshing = h.session.refresh();
  const rejected = assert.rejects(refreshing, kind('superseded'));
  h.api.login = async () => response('b');
  await h.session.login({});
  gate.resolve(response('a', 2));
  await rejected;
  assert.equal(h.disk(), 'refresh-b-1');
  assert.equal(h.session.getCredentials().token, 'access-b-1');
  assert.ok(h.calls.logout.includes('refresh-a-2'));
});

test('old retried 401 does not invalidate a more recent successful rotation', async () => {
  const h = httpHarness();
  await h.session.login({});
  const gate = deferred();
  const retried = deferred();
  let version = 1;
  h.handle(async config => {
    if (config.url === '/auth/refresh') return h.reply(config, response('a', ++version));
    if (config.headers.get('Authorization') === 'Bearer access-a-2') {
      retried.resolve();
      await gate.promise;
    }
    return h.reply(config, {}, 401);
  });
  const old = h.http.get('/private');
  const rejected = assert.rejects(old, error => error instanceof ApiError && error.status === 401);
  await retried.promise;
  await h.session.refresh();
  gate.resolve();
  await rejected;
  assert.equal(h.session.getSnapshot().status, 'authenticated');
  assert.equal(h.session.getCredentials().token, 'access-a-3');
});

test('refresh server errors preserve credentials and remain distinct from connectivity failures', async () => {
  const h = setup('saved');
  h.api.refresh = async () => { throw new ApiError('Unavailable', 503, undefined, []); };
  await assert.rejects(h.session.start(), kind('server'));
  assert.equal(h.disk(), 'saved');
  assert.equal(h.calls.delete, 0);
});

test('canonical profile fields survive a successful same-account token rotation', async () => {
  const h = setup();
  await h.session.login({});
  h.api.currentUser = async () => ({ ...profile(), avatar: 'https://example.test/avatar.png' });
  await h.session.refreshUser();
  await h.session.refresh();
  assert.equal(h.session.getSnapshot().user.avatar, 'https://example.test/avatar.png');
});

test('a late profile response cannot authenticate a session after rotation persistence failed', async () => {
  const h = httpHarness();
  await h.session.login({});
  const gate = deferred();
  h.handle(async config => {
    if (config.url === '/auth/me') { await gate.promise; return h.reply(config, profile()); }
    if (config.url === '/auth/refresh') return h.reply(config, response('a', 2));
    return h.reply(config, {});
  });
  const old = h.session.refreshUser();
  const rejected = assert.rejects(old, kind('superseded'));
  await tick();
  const original = h.storage.setRefreshToken;
  h.storage.setRefreshToken = async () => { throw new TokenStorageError('write'); };
  await assert.rejects(h.session.refresh(), kind('storage'));
  gate.resolve();
  await rejected;
  assert.equal(h.session.getSnapshot().status, 'unauthenticated');
  assert.equal(h.session.getCredentials().token, null);
  h.storage.setRefreshToken = original;
  await h.session.restore();
  assert.equal(h.session.getSnapshot().status, 'authenticated');
});

test('restoration requested synchronously by a logout subscriber cannot reopen the old session', async () => {
  const h = setup();
  await h.session.login({});
  let retry;
  let requested = false;
  const unsubscribe = h.session.subscribe(() => {
    if (!requested && h.session.getSnapshot().status === 'unauthenticated') {
      requested = true;
      retry = assert.rejects(h.session.restore(), kind('storage'));
    }
  });
  await h.session.logout();
  await retry;
  unsubscribe();
  assert.equal(h.disk(), null);
  assert.equal(h.calls.refresh, 0);
  assert.equal(h.session.getSnapshot().status, 'unauthenticated');
});
