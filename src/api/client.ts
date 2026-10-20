import { env } from "@/config/env";
import { AuthSession } from "@/features/auth/session";
import { tokenStorage } from "@/services/token-storage";
import { createAuthApi } from "./auth";
import { createHttpClient } from "./http-client";

// Composition happens once, outside React. The callback is evaluated only when
// a request runs, after authSession has been constructed (no module cycle).
export const api = createHttpClient(env.apiUrl, () => authSession);
export const authSession = new AuthSession(createAuthApi(api), tokenStorage);
