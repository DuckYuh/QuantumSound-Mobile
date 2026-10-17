// Access tokens live only in memory. AuthProvider will own the session lifecycle.
let accessToken: string | null = null;

export const accessTokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string): void {
    if (!token.trim()) throw new Error("Access token cannot be empty.");
    accessToken = token;
  },
  clear(): void {
    accessToken = null;
  },
};
