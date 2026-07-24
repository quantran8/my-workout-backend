import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthProvider, AuthUser } from './entities/auth-user.entity';

/** Payload trả về cho client sau register/login/refresh. */
export interface AuthSessionResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  tokenType: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  /**
   * Client dùng anon key: signUp/signInWithPassword phải chạy dưới quyền anon
   * để Supabase áp dụng đúng rate limit + email confirmation policy.
   */
  private anonClient!: SupabaseClient;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided in environment variables',
      );
    }
    this.anonClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** POST /auth/register — tạo tài khoản email/password. */
  async register(
    email: string,
    password: string,
    fullName?: string,
  ): Promise<AuthSessionResponse | { user: AuthUser; needsEmailConfirm: true }> {
    const { data, error } = await this.anonClient.auth.signUp({
      email,
      password,
      options: fullName ? { data: { full_name: fullName } } : undefined,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data.user) {
      throw new BadRequestException('Registration failed');
    }

    const user = this.toAuthUser(data.user);
    await this.ensureUserRow(user.id);

    // Khi project bật "Confirm email", Supabase không trả session ngay.
    if (!data.session) {
      return { user, needsEmailConfirm: true };
    }
    return this.toSessionResponse(user, data.session);
  }

  /** POST /auth/login — đăng nhập bằng email/password. */
  async login(email: string, password: string): Promise<AuthSessionResponse> {
    const { data, error } = await this.anonClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      // Không phân biệt "sai email" vs "sai password" để tránh lộ user enumeration.
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = this.toAuthUser(data.user);
    await this.ensureUserRow(user.id);
    return this.toSessionResponse(user, data.session);
  }

  /** POST /auth/refresh — đổi refresh token lấy access token mới. */
  async refresh(refreshToken: string): Promise<AuthSessionResponse> {
    const { data, error } = await this.anonClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    return this.toSessionResponse(this.toAuthUser(data.user), data.session);
  }

  /** POST /auth/logout — revoke refresh token của session hiện tại. */
  async logout(accessToken: string): Promise<{ success: true }> {
    const scoped = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      },
    );
    const { error: signOutError } = await scoped.auth.signOut();
    if (signOutError) {
      this.logger.warn(`Sign out failed: ${signOutError.message}`);
    }
    return { success: true };
  }

  /** Tạo User row nếu chưa có — auth.uid là id của bảng User. */
  private async ensureUserRow(userId: string): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });
  }

  private toSessionResponse(
    user: AuthUser,
    session: Session,
  ): AuthSessionResponse {
    return {
      user,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ?? null,
      tokenType: session.token_type,
    };
  }

  private toAuthUser(user: User): AuthUser {
    const meta = (user.user_metadata ?? {}) as {
      full_name?: string;
      name?: string;
      display_name?: string;
      avatar_url?: string;
      picture?: string;
    };
    const provider: AuthProvider =
      user.app_metadata?.provider === 'google' ? 'google' : 'email';

    const fullName = meta.full_name ?? meta.name ?? null;
    return {
      id: user.id,
      email: user.email ?? null,
      fullName,
      displayName: meta.display_name ?? fullName ?? null,
      avatarUrl: meta.avatar_url ?? meta.picture ?? null,
      provider,
    };
  }
}
