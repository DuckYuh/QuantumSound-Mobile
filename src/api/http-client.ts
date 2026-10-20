import { CanceledError, create, isAxiosError, isCancel, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import { AuthError, superseded } from "../features/auth/error";
import type { AuthSession } from "../features/auth/session";
import { normalizeApiError } from "./error";

declare module "axios" {
  interface AxiosRequestConfig {
    authMode?: "none" | "session";
    _session?: { epoch: number; token: string; retried: boolean };
  }
}

type Session = Pick<AuthSession, "getCredentials" | "refresh" | "invalidate">;
const exchanges = new Set(["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"]);

export function createHttpClient(baseURL: string, getSession: () => Session | undefined) {
  const http = create({ baseURL, timeout: 20_000, headers: { Accept: "application/json" } });
  const isManaged = (config: AxiosRequestConfig) => {
    const url = new URL(http.getUri(config), `${baseURL}/`);
    return url.origin === baseURL && config.authMode !== "none" && !exchanges.has(url.pathname.replace(/\/+$/, ""));
  };
  const assertCurrent = (config: InternalAxiosRequestConfig) => {
    if (config._session && config._session.epoch !== getSession()?.getCredentials().epoch) throw superseded();
  };

  http.interceptors.request.use((config) => {
    if (!isManaged(config)) return config;
    assertCurrent(config);
    const credentials = getSession()?.getCredentials();
    if (credentials?.token && (!config.headers.has("Authorization") || config._session)) {
      config._session = { epoch: credentials.epoch, token: credentials.token, retried: config._session?.retried ?? false };
      config.headers.set("Authorization", `Bearer ${credentials.token}`);
    }
    return config;
  });

  http.interceptors.response.use(
    (response) => { assertCurrent(response.config); return response; },
    async (error: unknown) => {
      if (isCancel(error) || error instanceof AuthError) throw error;
      if (!isAxiosError(error) || !error.config || !isManaged(error.config)) throw normalizeApiError(error);
      const config = error.config;
      assertCurrent(config);
      const session = getSession();
      const attempt = config._session;
      if (error.response?.status !== 401 || !session || !attempt) throw normalizeApiError(error);
      if (config.signal?.aborted) throw new CanceledError();
      if (attempt.retried) {
        // A delayed failure for an older credential must not invalidate a
        // newer rotation that has already succeeded in the same session.
        if (attempt.token === session.getCredentials().token) {
          const expired = new AuthError("session-expired", "Your session has expired.");
          await session.invalidate(attempt.epoch, expired);
          throw expired;
        }
        throw normalizeApiError(error);
      }
      const current = session.getCredentials();
      if (attempt.token === current.token || !current.token) await session.refresh(attempt.epoch);
      assertCurrent(config);
      if (config.signal?.aborted) throw new CanceledError();
      config._session = { ...attempt, retried: true };
      // Request interceptor replaces the expired Authorization header.
      return http.request(config);
    },
  );
  return http;
}
