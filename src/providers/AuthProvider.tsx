import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authSession } from "@/api/client";
import type { AuthSession, AuthState } from "@/features/auth/session";

type AuthContextValue = AuthState & Pick<AuthSession, "login" | "register" | "logout" | "refreshUser"> & {
  restoreSession: AuthSession["restore"];
};
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const serverSnapshot: AuthState = { status: "initializing", user: null, error: null };
const getServerSnapshot = () => serverSnapshot;

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const state = useSyncExternalStore(authSession.subscribe, authSession.getSnapshot, getServerSnapshot);

  useEffect(() => {
    const unbind = authSession.bindCache(() => queryClient.clear());
    // Failures are exposed through state.error; avoid an unhandled startup rejection.
    void authSession.start().catch(() => {});
    return unbind;
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    login: authSession.login,
    register: authSession.register,
    logout: authSession.logout,
    refreshUser: authSession.refreshUser,
    restoreSession: authSession.restore,
  }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
