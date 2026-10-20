import type { PropsWithChildren } from "react";

import { AuthProvider } from "./AuthProvider";
import { QueryProvider } from "./QueryProvider";

export function AppProviders({ children }: PropsWithChildren) {
  return <QueryProvider><AuthProvider>{children}</AuthProvider></QueryProvider>;
}
