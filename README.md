# QuantumSound Mobile

Expo/React Native foundation for QuantumSound, sharing the NestJS backend with the web and desktop applications. Routes deliberately render blank placeholders; authentication infrastructure is implemented, while application UI remains intentionally unimplemented.

The [setup report](docs/foundation-setup.md) contains the final file inventory, directory tree and validation results.

## Stack and setup

Expo SDK 57, React Native 0.86, React 19, Expo Router, strict TypeScript, TanStack Query 5, Axios, SecureStore and expo-audio. Use Node 22.13+ and pnpm 11.10.0. Expo, React Native, React and Router versions are preserved. The missing expo-audio native peer, expo-asset, is now a direct SDK-compatible dependency. expo-constants receives a targeted SDK 57 patch update to share one native version with expo-asset.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm start
```

On PowerShell, use `Copy-Item .env.example .env.local` and `pnpm.cmd` if script execution policy blocks `pnpm.ps1`. Preserve an existing local environment file instead of overwriting it.

| Script | Purpose |
| --- | --- |
| `pnpm start` | Start Metro / Expo |
| `pnpm android` / `pnpm ios` | Open the dev server on Android / iOS |
| `pnpm web` | Start the web preview |
| `pnpm lint` | Expo ESLint configuration |
| `pnpm typecheck` | Strict TypeScript check |
| `pnpm test` | Node auth lifecycle and real Axios interceptor tests |
| `pnpm exec expo install --check` | SDK dependency compatibility |
| `pnpm dlx expo-doctor` | Project diagnostics without adding a runtime dependency |

Install future dependencies with `pnpm exec expo install <package> --pnpm` (add `--dev` for tools). ESLint 9 is pinned to its major for compatibility with the Expo lint plugin ecosystem. `pnpm-workspace.yaml` explicitly disables the optional unrs-resolver build script; its platform binary is supplied by an optional dependency.

## Environment

`src/config/env.ts` validates `EXPO_PUBLIC_API_URL` at startup as an HTTP(S) origin and removes trailing slashes. The example uses `https://quantumsound-server.onrender.com`. The backend has **no `/api` prefix**: request paths start with `/auth`, `/tracks`, etc. Do not put a path, query, credentials or fragment in the base URL.

For local development use `http://<computer-LAN-IP>:3001` on a physical device or `http://10.0.2.2:3001` on the standard Android emulator. The backend must listen on an accessible interface. Device `localhost` refers to the device. Use HTTPS for production and development builds where platform transport policies require it; no global cleartext exception is configured. Restart Metro after changing environment values.

Expo inlines `EXPO_PUBLIC_*` values into the bundle: they are public configuration, never secrets. Signing credentials, backend keys and service secrets must not be placed there. `.env*` files are ignored except `.env.example`. Existing local files remain untouched. The native app is not subject to browser CORS; the optional web preview currently needs a backend-approved origin or development proxy.

## Source structure

```text
assets/images/             Original brand sources and generated native raster assets
src/
  app/
    _layout.tsx            Root Stack, splash, status bar, theme, global providers
    index.tsx              Redirect to the Home tab
    (auth)/                Auth Stack; login and register placeholders
    (tabs)/                Home, Search, Library placeholders and tab navigator
    album/[slug].tsx
    playlist/[id].tsx
    profile/[username].tsx
    track/[id].tsx
  api/
    client.ts              Single HTTP/session composition
    auth.ts                Typed backend auth API and response validation
    http-client.ts         Session-aware Axios interceptors
    error.ts               Safe typed API errors
  config/env.ts            Validated public environment
  features/auth/           AuthSession lifecycle, public types and AuthError
  providers/
    AppProviders.tsx       QueryProvider > AuthProvider, outside navigation groups
    AuthProvider.tsx       React subscription, startup and useAuth
    QueryProvider.tsx      Stable QueryClient and native AppState focus subscription
  services/
    token-storage.ts       Secure refresh-token persistence
    token-storage-error.ts Sanitized storage failure type
  theme/
    colors.ts
    spacing.ts
    radius.ts
    typography.ts
    navigation.ts
    index.ts
```

Create additional presentation, domain and utility directories only when real implementations require them. Keep non-route code outside `app`. Import source with `@/` and assets with `@/assets/`.

## Navigation and providers

Expo Router owns navigation and typed routes. Existing dynamic paths are preserved. The entry route redirects to `/(tabs)`; no authentication guard is installed. The dark root Stack contains auth, tabs and detail routes. Tabs have native safe-area sizing, text labels and brand active/inactive colors, with no custom icons. Auth is a separate nested Stack.

`AppProviders` persists above the navigators. QueryClient is created once per provider, with 60-second freshness, five-minute unused cache retention, at most two retries for transport/server failures and no automatic mutation, client-error or AuthError retries. AppState updates focus on native; browser focus remains managed by TanStack. Native network reachability is not wired yet: add Expo Network/onlineManager when offline behavior is implemented. Pass Query's AbortSignal into Axios requests when adding queries.

## Theme and typography

The web `client/src/styles/theme.css` supplies the brand palette, four-point spacing and radius values. Native text styles use `TextStyle` validation. Navigation extends the installed Router's complete DarkTheme, retaining its platform font defaults. Status bar content is light on the dark background.

The web uses `next/font/google` Geist and Geist Mono. No reusable local TTF/OTF files were found, so native typography uses centralized system fonts immediately, without a fake loading step. To adopt Geist, add licensed static TTF/OTF weights (400/500/600/700) to `assets/fonts`, load them with the existing `expo-font` dependency, update role families and navigation fonts, and gate splash dismissal on either font readiness or a handled loading error. Do not use Next font loaders or browser WOFF files in native code.

## Authentication architecture and token lifecycle

`AppProviders` composes QueryProvider > AuthProvider above navigation. `useAuth()` exposes a discriminated `status` (`initializing`, `authenticated`, `unauthenticated`), `user`, `error`, and async `login(input)`, `register(input)`, `logout()`, `refreshUser()` and `restoreSession()` actions. Operational failures reject with `AuthError`; callers must handle rejections. An expired saved session resolves restoration into unauthenticated state with a session-expired error. Startup errors are caught by the provider and remain available through `error`. There are no auth redirects or login requirements.

One `AuthSession` owns state and credentials. React subscribes with `useSyncExternalStore`, without a second copy of session state. The HTTP client and its interceptors are created once outside React. Startup is idempotent under Strict Mode. Provider cleanup detaches the QueryClient callback without logging out or canceling token rotation.

Verified against `server/src/auth`, its DTOs, Prisma enums and `UsersService.findPublicByEmail`:

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /auth/login` | email, password (minimum 8 characters) | AuthResponse |
| `POST /auth/register` | username (minimum 3), displayName (minimum 1), email, password (minimum 8) | AuthResponse |
| `POST /auth/refresh` | `{ refresh_token: string }` | AuthResponse with rotated token/session |
| `GET /auth/me` | Bearer access token | CurrentUser |
| `POST /auth/logout` | `{ refresh_token: string }` | `{ message: string }` |

AuthResponse contains `access_token`, `refresh_token`, `session_id` and user `{ id, username, displayName, email, role }`. Roles are USER/ADMIN. CurrentUser additionally includes nullable avatar/bio/country, ACTIVE/BANNED/DELETED status, and serialized createdAt/updatedAt dates. Response validation rejects incomplete payloads. `refreshUser()` loads this canonical profile and invalidates inactive users. Access tokens last 15 minutes; refresh sessions last 30 days. Refresh revokes the old session and creates a new one atomically. There is no `/api` prefix or cookie-based mobile refresh contract.

Session restoration reads SecureStore and exchanges an existing refresh token. Access tokens remain in memory only. A replacement refresh token must be persisted before the session becomes authenticated or waiting requests replay. `tokenStorage` retains its dedicated service and device-only iOS accessibility after first unlock. Native storage failures reject with sanitized TokenStorageError, converted to `AuthError` by the session layer. No credentials are logged or included in normalized error request configurations.

Only same-origin requests using the session's Bearer token participate in automatic 401 handling. Login, register, refresh and logout never attach session tokens or trigger refresh. Explicit `authMode: "none"`, manually supplied Authorization headers and external origins opt out. Concurrent 401s share one refresh promise; late 401s reuse an already rotated access token. Each request replays at most once. A second 401 invalidates the session unless its token was superseded by another successful rotation. Cancellation does not cancel a shared refresh, and canceled requests do not replay.

Epochs distinguish accounts/sessions. Logout and account switching immediately clear in-memory credentials, user state and the entire TanStack cache (including public entries, conservatively). QueryClient.clear cancels/removes queries. Old authenticated responses and 401s are rejected after a session change, preventing stale data from repopulating the cache or refreshing a different account. SecureStore operations run in order, so an older in-flight write cannot be the final write after logout/new login. Late credential responses are discarded and their refresh tokens are revoked best-effort.

Failure recovery:

- `invalid-credentials`: rejected login; `request`: validation/conflict response; `session-expired`: terminal 401/403; `network`: transport/timeout; `server`: backend failure; `storage`: SecureStore failure; `invalid-response`: malformed auth payload; `superseded`: a newer session operation won.
- Temporary refresh network/5xx failures preserve persistent credentials. Startup becomes unauthenticated with an error and can retry with `restoreSession()`. An already authenticated session remains available with the failure exposed.
- If persisting a rotated token fails, the replacement is retained only in memory and access/user/cache are cleared. `restoreSession()` retries persistence without exchanging the revoked old token. Do not terminate the process before retrying if recovering that replacement matters.
- Logout clears memory/cache immediately and attempts local deletion before waiting for remote revocation. Failure rejects even though local sign-out has occurred. Failed deletion blocks restoration in this runtime; retry `logout()` to complete cleanup. A new login begins by clearing the previous session and must complete storage cleanup before calling the server.

`pnpm test` uses Node's test runner, the installed TypeScript compiler, real Axios interceptors/adapters and a real QueryClient. Native storage and backend responses are controlled fixtures; tests cover lifecycle, rotation, invalidation, failure recovery, cancellation and concurrent account/logout races. No test framework dependency is added.

Limitations: native SecureStore behavior still needs device testing. Web has no persistent credential fallback and reports unsupported storage; guest routes remain usable. A process death after server rotation but before persistence can lose the replacement; likewise a lost successful refresh response cannot be recovered without backend idempotency/grace support. Both local deletion and remote revocation can fail during logout; this is surfaced and cannot guarantee durable sign-out across a process restart until cleanup succeeds. Offline remote revocation and stale-token cleanup are best-effort; server sessions otherwise expire by TTL. SecureStore may survive iOS reinstalls. Backend logout revokes refresh sessions, not already issued 15-minute access JWTs; the backend login/JWT strategy also does not consistently reject inactive users, so client checks are not a substitute for backend authorization enforcement.

## Audio plan

The installed `expo-audio` 57.0.5 plugin enables background playback and disables recording and microphone permissions. Configuration alone does not start audio or provide a player. Add one meaningful AudioProvider at the root when implementing playback so navigating between screens does not destroy it. It will own the player lifecycle, queue, seeking, repeat/shuffle, interruptions and metadata.

On playback initialization, use `setAudioModeAsync` with `playsInSilentMode`, `shouldPlayInBackground` and the chosen interruption policy. Attach lock-screen metadata/controls with `setActiveForLockScreen`; Android requires active lock-screen controls for sustained background playback. iOS uses the audio background mode. Test controls, audio interruptions, Bluetooth/headphone disconnects and cleanup on actual devices. Web playback follows browser autoplay/background restrictions.

Native plugin changes require a new binary. Expo Go can check basic bundled audio APIs but cannot validate this app's native background capabilities, launch assets or SecureStore lifecycle. Install `expo-dev-client` via Expo and configure a development build before device verification. Build with `pnpm dlx eas-cli@latest build --profile development` after adding `eas.json`; no EAS project or build profiles are fabricated here. `ios/` and `android/` remain generated by CNG and must not be edited by hand.

## Branding and remaining work

The existing QuantumSound logo sources in `assets/images/Logo*` match the web branding. Native icon (1024px), adaptive foreground (432px), splash (512px) and favicon (48px) are raster compositions from `Logo2000x2000.png`. Adaptive foreground is padded for masking. The Android monochrome asset uses the waveform geometry from `Logo.svg` in white on transparency. No Expo template assets remain in app configuration.

`com.quantumsound.mobile` follows the desktop convention `com.quantumsound.desktop`; confirm ownership/store availability before release. Confirm Expo account/owner, EAS project ID, development/production profiles and signing credentials before creating cloud builds. Verify icons/splash/masking and background audio in native builds. No native builds have been executed by this setup.

Next phase: implement accessible themed authentication UI using useAuth, then the three primary tabs, followed by persistent audio playback. Keep navigation access policy explicit when those screens are introduced.

Documentation references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Expo Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/), [environment variables](https://docs.expo.dev/guides/environment-variables/), [TanStack React Native](https://tanstack.com/query/latest/docs/framework/react/react-native).
