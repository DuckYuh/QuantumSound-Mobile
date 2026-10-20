import type { AxiosInstance } from "axios";
import { AuthError } from "../features/auth/error";
import type { AuthApi, AuthResponse, AuthUser } from "../features/auth/types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function invalid(): never {
  throw new AuthError("invalid-response", "The server returned an invalid authentication response.");
}

function user(value: unknown): AuthUser {
  if (!record(value)) return invalid();
  const { id, username, displayName, email, role } = value;
  if (typeof id !== "string" || !id || typeof username !== "string" || !username ||
    typeof displayName !== "string" || !displayName || typeof email !== "string" || !email ||
    (role !== "USER" && role !== "ADMIN")) return invalid();
  return { id, username, displayName, email, role };
}

function session(value: unknown): AuthResponse {
  if (!record(value)) return invalid();
  const { access_token, refresh_token, session_id } = value;
  if (typeof access_token !== "string" || !access_token.trim() ||
    typeof refresh_token !== "string" || !refresh_token.trim() ||
    typeof session_id !== "string" || !session_id.trim()) return invalid();
  return { access_token, refresh_token, session_id, user: user(value.user) };
}

// The same Axios instance is used for every endpoint. Credential exchanges opt
// out of session attachment/refresh, so a rejected refresh can never recurse.
export function createAuthApi(http: AxiosInstance): AuthApi {
  const exchange = { authMode: "none" as const };
  return {
    login: async (input) => session((await http.post<unknown>("/auth/login", input, exchange)).data),
    register: async (input) => session((await http.post<unknown>("/auth/register", input, exchange)).data),
    refresh: async (token) => session((await http.post<unknown>("/auth/refresh", { refresh_token: token }, exchange)).data),
    logout: async (token) => { await http.post("/auth/logout", { refresh_token: token }, exchange); },
    currentUser: async () => {
      const { data } = await http.get<unknown>("/auth/me");
      if (!record(data)) return invalid();
      const base = user(data);
      const { avatar, bio, country, status, createdAt, updatedAt } = data;
      if (!nullableString(avatar) || !nullableString(bio) || !nullableString(country) ||
        (status !== "ACTIVE" && status !== "BANNED" && status !== "DELETED") ||
        typeof createdAt !== "string" || typeof updatedAt !== "string") return invalid();
      return { ...base, avatar, bio, country, status, createdAt, updatedAt };
    },
  };
}
