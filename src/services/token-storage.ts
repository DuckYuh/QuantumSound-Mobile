import * as SecureStore from "expo-secure-store";

const refreshTokenKey = "quantumsound.refresh-token";
const options: SecureStore.SecureStoreOptions = {
  keychainService: "quantumsound.auth",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export class TokenStorageError extends Error {
  constructor(public readonly operation: "read" | "write" | "delete") {
    super(`Secure token storage failed to ${operation}.`);
    this.name = "TokenStorageError";
  }
}

async function securely<T>(
  operation: TokenStorageError["operation"],
  action: () => Promise<T>,
): Promise<T> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      throw new TokenStorageError(operation);
    }
    return await action();
  } catch {
    // Do not expose native errors that might contain credential values.
    // Failure is distinct from an absent token; callers must not assume success.
    throw new TokenStorageError(operation);
  }
}

export const tokenStorage = {
  getRefreshToken(): Promise<string | null> {
    return securely("read", () => SecureStore.getItemAsync(refreshTokenKey, options));
  },
  setRefreshToken(token: string): Promise<void> {
    if (!token.trim()) return Promise.reject(new TokenStorageError("write"));
    return securely("write", () => SecureStore.setItemAsync(refreshTokenKey, token, options));
  },
  deleteRefreshToken(): Promise<void> {
    return securely("delete", () => SecureStore.deleteItemAsync(refreshTokenKey, options));
  },
};
