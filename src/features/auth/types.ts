export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  username: string;
  displayName: string;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: "USER" | "ADMIN";
}

// JWT strategy selects these additional fields for GET /auth/me.
export interface CurrentUser extends AuthUser {
  avatar: string | null;
  bio: string | null;
  country: string | null;
  status: "ACTIVE" | "BANNED" | "DELETED";
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  session_id: string;
  user: AuthUser;
}

export interface AuthApi {
  login(input: LoginInput): Promise<AuthResponse>;
  register(input: RegisterInput): Promise<AuthResponse>;
  refresh(token: string): Promise<AuthResponse>;
  currentUser(): Promise<CurrentUser>;
  logout(token: string): Promise<void>;
}

export interface RefreshTokenStorage {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  deleteRefreshToken(): Promise<void>;
}
