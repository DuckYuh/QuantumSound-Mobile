import { isAxiosError } from "axios";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly code: string | undefined,
    public readonly messages: readonly string[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!isAxiosError<unknown>(error)) {
    return new ApiError("An unexpected request error occurred.", undefined, undefined, []);
  }
  const data = error.response?.data;
  const message = typeof data === "object" && data !== null && "message" in data
    ? data.message : undefined;
  const messages = typeof message === "string"
    ? [message]
    : Array.isArray(message) ? message.filter((item): item is string => typeof item === "string") : [];

  return new ApiError(
    messages.join(" ") || (error.response ? "The request failed." : "Unable to reach the server."),
    error.response?.status,
    error.code,
    messages,
  );
}
