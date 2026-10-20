import { AuthError, authError, superseded } from "./error";
import type { AuthApi, AuthResponse, AuthUser, CurrentUser, LoginInput, RefreshTokenStorage, RegisterInput } from "./types";

export type AuthState = {
  status: "initializing" | "unauthenticated";
  user: null;
  error: AuthError | null;
} | {
  status: "authenticated";
  user: AuthUser | CurrentUser;
  error: AuthError | null;
};

export interface SessionCredentials { epoch: number; token: string | null }

/** One owner for session state, credentials, rotation and serialized disk writes. */
export class AuthSession {
  private state: AuthState = { status: "initializing", user: null, error: null };
  private epoch = 0;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private pending: AuthResponse | null = null;
  private storageTail: Promise<unknown> = Promise.resolve();
  private flight: { epoch: number; promise: Promise<string> } | null = null;
  private startup: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private clearCache = () => {};
  private restorationBlocked = false;

  constructor(private api: AuthApi, private storage: RefreshTokenStorage) {}

  getSnapshot = (): AuthState => this.state;
  getCredentials = (): SessionCredentials => ({ epoch: this.epoch, token: this.accessToken });
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  bindCache(clear: () => void): () => void {
    this.clearCache = clear;
    return () => { if (this.clearCache === clear) this.clearCache = () => {}; };
  }

  private publish(state: AuthState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  private check(epoch: number): void {
    if (epoch !== this.epoch) throw superseded();
  }

  private disk<T>(action: () => Promise<T>): Promise<T> {
    const next = this.storageTail.then(action);
    this.storageTail = next.catch(() => {});
    return next;
  }

  private retire(token: string | null): void {
    if (token) void this.api.logout(token).catch(() => {});
  }

  private reset(status: "initializing" | "unauthenticated"): number {
    ++this.epoch;
    this.restorationBlocked = true;
    this.accessToken = null;
    this.refreshToken = null;
    this.pending = null;
    this.clearCache(); // QueryClient.clear also cancels/removes in-flight queries.
    this.publish({ status, user: null, error: null });
    return this.epoch;
  }

  private report(error: unknown, epoch: number, login = false): AuthError {
    if (epoch !== this.epoch) {
      // An intentional invalidation changes the epoch too. Keep its published
      // cleanup failure distinguishable from an unrelated account switch.
      return error instanceof AuthError && error === this.state.error ? error : superseded();
    }
    const normalized = authError(error, login);
    this.publish(this.state.status === "authenticated"
      ? { ...this.state, error: normalized }
      : { status: "unauthenticated", user: null, error: normalized });
    return normalized;
  }

  private async commit(response: AuthResponse, epoch: number): Promise<string> {
    if (epoch !== this.epoch) { this.retire(response.refresh_token); throw superseded(); }
    // Keep the rotated credential in memory if SecureStore fails. Retrying
    // restoration persists this response, rather than reusing a revoked token.
    this.pending = response;
    this.refreshToken = response.refresh_token;
    try {
      await this.disk(async () => {
        this.check(epoch);
        await this.storage.setRefreshToken(response.refresh_token);
      });
      this.check(epoch);
    } catch (error) {
      if (epoch !== this.epoch) { this.retire(response.refresh_token); throw superseded(); }
      // Reject older authenticated requests as well as clearing their cache;
      // otherwise a late profile response could authenticate a storage-failed session.
      ++this.epoch;
      this.accessToken = null;
      this.clearCache();
      const failure = authError(error);
      this.publish({ status: "unauthenticated", user: null, error: failure });
      throw failure;
    }
    const previousUser = this.state.status === "authenticated" ? this.state.user : null;
    if (previousUser && previousUser.id !== response.user.id) this.clearCache();
    const user = previousUser?.id === response.user.id ? { ...previousUser, ...response.user } : response.user;
    this.pending = null;
    this.accessToken = response.access_token;
    this.restorationBlocked = false;
    this.publish({ status: "authenticated", user, error: null });
    return response.access_token;
  }

  // Idempotent during React Strict Mode's effect replay. Explicit restoration
  // retries use restore(), which can recover from offline/storage failures.
  start = (): Promise<void> => this.startup ??= this.restore();

  restore = async (): Promise<void> => {
    const epoch = this.epoch;
    try {
      if (this.restorationBlocked && !this.pending) throw new AuthError("storage", "Finish clearing stored credentials before restoring a session.");
      if (!this.pending && !this.refreshToken) {
        const token = await this.disk(() => this.storage.getRefreshToken());
        this.check(epoch);
        if (!token) {
          this.publish({ status: "unauthenticated", user: null, error: null });
          return;
        }
        this.refreshToken = token;
      }
      await this.refresh(epoch);
    } catch (error) {
      if (error instanceof AuthError && error.kind === "session-expired" && epoch !== this.epoch) return;
      throw this.report(error, epoch);
    }
  };

  refresh = (epoch = this.epoch): Promise<string> => {
    if (epoch !== this.epoch) return Promise.reject(superseded());
    if (this.flight?.epoch === epoch) return this.flight.promise;
    const promise = this.rotate(epoch).finally(() => {
      if (this.flight?.promise === promise) this.flight = null;
    });
    this.flight = { epoch, promise };
    return promise;
  };

  private async rotate(epoch: number): Promise<string> {
    try {
      if (this.pending) return await this.commit(this.pending, epoch);
      const token = this.refreshToken ?? await this.disk(() => this.storage.getRefreshToken());
      this.check(epoch);
      if (!token) {
        throw new AuthError("session-expired", "No saved session is available.");
      }
      this.refreshToken = token;
      const response = await this.api.refresh(token);
      return await this.commit(response, epoch);
    } catch (error) {
      if (epoch !== this.epoch) throw this.report(error, epoch);
      const normalized = authError(error);
      if (normalized.kind === "session-expired" || normalized.kind === "invalid-response") {
        await this.invalidate(epoch, normalized);
      } else {
        this.report(normalized, epoch);
      }
      throw normalized;
    }
  }

  login = (input: LoginInput): Promise<void> => this.authenticate(() => this.api.login(input), true);
  register = (input: RegisterInput): Promise<void> => this.authenticate(() => this.api.register(input), false);

  private async authenticate(exchange: () => Promise<AuthResponse>, login: boolean): Promise<void> {
    const previous = this.refreshToken;
    const epoch = this.reset("initializing");
    this.restorationBlocked = true;
    this.retire(previous);
    try {
      await this.disk(async () => { this.check(epoch); await this.storage.deleteRefreshToken(); });
      this.check(epoch);
      this.restorationBlocked = false;
      const response = await exchange();
      await this.commit(response, epoch);
    } catch (error) {
      throw this.report(error, epoch, login);
    }
  }

  invalidate = async (epoch: number, error = new AuthError("session-expired", "Your session has expired.")): Promise<void> => {
    if (epoch !== this.epoch) throw superseded();
    this.retire(this.refreshToken);
    const next = this.reset("unauthenticated");
    this.restorationBlocked = true;
    this.publish({ status: "unauthenticated", user: null, error });
    try {
      await this.disk(async () => { this.check(next); await this.storage.deleteRefreshToken(); });
      this.check(next);
      this.restorationBlocked = false;
    } catch (failure) {
      throw this.report(failure, next);
    }
  };

  logout = async (): Promise<void> => {
    let token = this.refreshToken;
    const epoch = this.reset("unauthenticated");
    this.restorationBlocked = true;
    let failure: unknown;
    try {
      await this.disk(async () => {
        this.check(epoch);
        try { token ??= await this.storage.getRefreshToken(); }
        finally { await this.storage.deleteRefreshToken(); }
      });
      this.check(epoch);
      this.restorationBlocked = false;
    } catch (error) { failure = error; }
    // Local sign-out is never contingent on network availability.
    try { if (token) await this.api.logout(token); }
    catch (error) { failure ??= error; }
    if (failure) throw this.report(failure, epoch);
  };

  refreshUser = async (): Promise<void> => {
    const epoch = this.epoch;
    if (!this.accessToken) throw new AuthError("session-expired", "Sign in before requesting your profile.");
    try {
      const user = await this.api.currentUser();
      this.check(epoch);
      if (user.status !== "ACTIVE") {
        await this.invalidate(epoch);
        return;
      }
      this.publish({ status: "authenticated", user, error: null });
    } catch (error) { throw this.report(error, epoch); }
  };
}
