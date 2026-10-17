# QuantumSound Mobile

Expo/React Native foundation for QuantumSound, sharing the NestJS backend with the web and desktop applications. Routes deliberately render blank placeholders; application UI and business features are not implemented.

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
    client.ts              One Axios instance and interceptors
    error.ts               Safe typed API errors
  config/env.ts            Validated public environment
  providers/
    AppProviders.tsx       Global composition, outside navigation groups
    QueryProvider.tsx      Stable QueryClient and native AppState focus subscription
  services/
    access-token.ts        Memory-only access token
    token-storage.ts       Secure refresh-token persistence
  theme/
    colors.ts
    spacing.ts
    radius.ts
    typography.ts
    navigation.ts
    index.ts
```

Create `components/{ui,layout,music,player}`, `features`, `hooks`, `lib` and `types` only when real implementations require them. Keep non-route code outside `app`. Import source with `@/` and assets with `@/assets/`.

## Navigation and providers

Expo Router owns navigation and typed routes. Existing dynamic paths are preserved. The entry route redirects to `/(tabs)`; no authentication guard is installed. The dark root Stack contains auth, tabs and detail routes. Tabs have native safe-area sizing, text labels and brand active/inactive colors, with no custom icons. Auth is a separate nested Stack.

`AppProviders` persists above the navigators. QueryClient is created once per provider, with 60-second freshness, five-minute unused cache retention, at most two retries for transport/server failures and no automatic mutation or client-error retries. AppState updates focus on native; browser focus remains managed by TanStack. Native network reachability is not wired yet: add Expo Network/onlineManager when offline behavior is implemented. Pass Query's AbortSignal into Axios requests when adding queries.

## Theme and typography

The web `client/src/styles/theme.css` supplies the brand palette, four-point spacing and radius values. Native text styles use `TextStyle` validation. Navigation extends the installed Router's complete DarkTheme, retaining its platform font defaults. Status bar content is light on the dark background.

The web uses `next/font/google` Geist and Geist Mono. No reusable local TTF/OTF files were found, so native typography uses centralized system fonts immediately, without a fake loading step. To adopt Geist, add licensed static TTF/OTF weights (400/500/600/700) to `assets/fonts`, load them with the existing `expo-font` dependency, update role families and navigation fonts, and gate splash dismissal on either font readiness or a handled loading error. Do not use Next font loaders or browser WOFF files in native code.

## Authentication infrastructure and backend contract

`api` has a 20-second timeout, an Accept header, a request interceptor that adds the memory token only for the configured backend origin, and a response interceptor that converts Nest errors into `ApiError` (`status`, `code`, `messages`). Axios cancellation stays recognizable. Errors do not retain request configurations or tokens. Callers should use relative backend paths and handle rejected requests.

Verified against `server/src/auth`:

- `POST /auth/login` accepts email/password; `POST /auth/register` accepts username, displayName, email and password.
- Login, registration and refresh return `access_token`, `refresh_token`, `session_id` and a user with id, username, displayName, email and role.
- `POST /auth/refresh` and `POST /auth/logout` accept `{ refresh_token: string }` in the JSON body; `GET /auth/me` requires a Bearer access token.
- Refresh tokens expire after 30 days. Each successful refresh revokes the old session and creates a replacement; simultaneous requests with the old token cannot both succeed.

`accessTokenStore` holds access tokens only in memory. `tokenStorage` reads, writes and deletes refresh tokens using SecureStore with a dedicated service and iOS device-only accessibility after first unlock. Absence returns null; native failures or unsupported platforms reject with a sanitized `TokenStorageError`, never silently pretending a write/delete succeeded. There is no browser localStorage fallback. Web authentication remains unimplemented.

AuthProvider, session restoration and refresh execution are intentionally deferred. The next implementation must use one refresh operation shared by concurrent requests, exclude refresh calls from retry interception, retry each original request at most once, persist the rotated refresh token before exposing the new session, handle storage failures explicitly, clear memory/cache and invalidate credentials on terminal auth failure, and prevent stale requests from restoring a logged-out session. SecureStore can survive iOS reinstalls: do not infer session validity from stored-token presence.

## Audio plan

The installed `expo-audio` 57.0.5 plugin enables background playback and disables recording and microphone permissions. Configuration alone does not start audio or provide a player. Add one meaningful AudioProvider at the root when implementing playback so navigating between screens does not destroy it. It will own the player lifecycle, queue, seeking, repeat/shuffle, interruptions and metadata.

On playback initialization, use `setAudioModeAsync` with `playsInSilentMode`, `shouldPlayInBackground` and the chosen interruption policy. Attach lock-screen metadata/controls with `setActiveForLockScreen`; Android requires active lock-screen controls for sustained background playback. iOS uses the audio background mode. Test controls, audio interruptions, Bluetooth/headphone disconnects and cleanup on actual devices. Web playback follows browser autoplay/background restrictions.

Native plugin changes require a new binary. Expo Go can check basic bundled audio APIs but cannot validate this app's native background capabilities, launch assets or SecureStore lifecycle. Install `expo-dev-client` via Expo and configure a development build before device verification. Build with `pnpm dlx eas-cli@latest build --profile development` after adding `eas.json`; no EAS project or build profiles are fabricated here. `ios/` and `android/` remain generated by CNG and must not be edited by hand.

## Branding and remaining work

The existing QuantumSound logo sources in `assets/images/Logo*` match the web branding. Native icon (1024px), adaptive foreground (432px), splash (512px) and favicon (48px) are raster compositions from `Logo2000x2000.png`. Adaptive foreground is padded for masking. The Android monochrome asset uses the waveform geometry from `Logo.svg` in white on transparency. No Expo template assets remain in app configuration.

`com.quantumsound.mobile` follows the desktop convention `com.quantumsound.desktop`; confirm ownership/store availability before release. Confirm Expo account/owner, EAS project ID, development/production profiles and signing credentials before creating cloud builds. Verify icons/splash/masking and background audio in native builds. No native builds have been executed by this setup.

Next phase: implement AuthProvider with tested refresh rotation and session lifecycle, followed by accessible themed UI and the three primary tabs, then persistent audio playback. Add focused integration tests for authentication concurrency and token storage failure handling as those flows are implemented.

Documentation references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Expo Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/), [environment variables](https://docs.expo.dev/guides/environment-variables/), [TanStack React Native](https://tanstack.com/query/latest/docs/framework/react/react-native).
