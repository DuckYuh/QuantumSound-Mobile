import { ApiError } from "../../api/error";
import { TokenStorageError } from "../../services/token-storage-error";

export type AuthErrorKind =
  | "invalid-credentials" | "session-expired" | "network" | "storage"
  | "request" | "server" | "invalid-response" | "superseded";

export class AuthError extends Error {
  constructor(public readonly kind: AuthErrorKind, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function authError(error: unknown, login = false): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof TokenStorageError) return new AuthError("storage", error.message);
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return new AuthError(login ? "invalid-credentials" : "session-expired",
        login ? "Invalid credentials." : "Your session has expired.");
    }
    if (error.status === undefined) return new AuthError("network", "Unable to reach the server. Try again.");
    return new AuthError(error.status >= 500 ? "server" : "request", error.message);
  }
  return new AuthError("server", "Authentication could not be completed.");
}

export function superseded(): AuthError {
  return new AuthError("superseded", "The session changed before this operation completed.");
}
