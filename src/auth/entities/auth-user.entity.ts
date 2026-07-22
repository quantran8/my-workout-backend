export type AuthProvider = 'email' | 'google';

export interface AuthUser {
  id: string;
  email: string | null;
  fullName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  provider: AuthProvider;
}
