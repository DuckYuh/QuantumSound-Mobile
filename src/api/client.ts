import { create, isCancel } from "axios";

import { env } from "@/config/env";
import { accessTokenStore } from "@/services/access-token";
import { normalizeApiError } from "./error";

export const api = create({
  baseURL: env.apiUrl,
  timeout: 20_000,
  headers: { Accept: "application/json" },
});

api.interceptors.request.use((config) => {
  const token = accessTokenStore.get();
  // Only send credentials to the configured backend, never an external URL.
  const target = new URL(api.getUri(config), `${env.apiUrl}/`);
  if (token && target.origin === env.apiUrl && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    // Preserve Axios cancellation so Query can recognize aborted requests.
    if (isCancel(error)) return Promise.reject(error);
    return Promise.reject(normalizeApiError(error));
  },
);
