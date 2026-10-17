function parseApiUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("EXPO_PUBLIC_API_URL is required. Copy .env.example to .env.local.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL must be an absolute HTTP(S) URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash ||
    url.pathname.replace(/\/+$/, "") !== ""
  ) {
    throw new Error("EXPO_PUBLIC_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.");
  }
  return url.origin;
}

export const env = {
  apiUrl: parseApiUrl(process.env.EXPO_PUBLIC_API_URL),
} as const;
