export class TokenStorageError extends Error {
  constructor(public readonly operation: "read" | "write" | "delete") {
    super(`Secure token storage failed to ${operation}.`);
    this.name = "TokenStorageError";
  }
}
