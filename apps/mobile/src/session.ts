import { ApiError, profile, tokens, type Profile, type RequestOptions, type Tokens, Transport } from "./api";
export type Startup =
  | "BOOTING"
  | "ANONYMOUS"
  | "AUTHENTICATING"
  | "AUTHENTICATED"
  | "OFFLINE_CACHE"
  | "SESSION_EXPIRED"
  | "NETWORK_UNAVAILABLE"
  | "FATAL_CONFIGURATION_ERROR";
export type Snapshot = {
  state: Startup;
  user?: Profile;
  error?: string;
  revocationStatus?: "REVOCATION_UNCONFIRMED";
};
export interface Vault {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}
export interface SessionLifecycle {
  readLastIdentity(): Promise<Profile | null>;
  saveLastIdentity(user: Profile): Promise<void>;
  clearLastIdentity(): Promise<void>;
  clearUserData(userId: string): Promise<void>;
  hasOfflineData(userId: string): Promise<boolean>;
}
const noLifecycle: SessionLifecycle = {
  readLastIdentity: async () => null,
  saveLastIdentity: async () => {},
  clearLastIdentity: async () => {},
  clearUserData: async () => {},
  hasOfflineData: async () => false,
};
export class Session {
  snapshot: Snapshot = { state: "BOOTING" };
  private credential?: Tokens;
  private flight?: Promise<void>;
  private restoreFlight?: Promise<void>;
  private epoch = 0;
  private writes = Promise.resolve();
  private lastUserId?: string;
  private listeners = new Set<() => void>();
  constructor(
    readonly api: Transport,
    private vault: Vault,
    private lifecycle: SessionLifecycle = noLifecycle,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((fn) => fn());
  }
  private persist(action: () => Promise<void>) {
    const next = this.writes.then(action, action);
    this.writes = next.catch(() => {});
    return next;
  }
  private async accept(value: unknown, epoch: number) {
    const next = tokens(value);
    if (epoch !== this.epoch) throw new ApiError("cancelled");
    await this.persist(() =>
      this.vault.write(JSON.stringify({ sessionId: next.sessionId, refreshToken: next.refreshToken })),
    );
    if (epoch !== this.epoch) throw new ApiError("cancelled");
    this.credential = next;
  }
  private async identity(epoch: number) {
    const user = profile(await this.api.request("/api/v1/me", { token: this.credential?.accessToken }));
    if (epoch !== this.epoch) return;
    const previous = this.lastUserId ?? (await this.lifecycle.readLastIdentity())?.userId;
    if (previous && previous !== user.userId) await this.lifecycle.clearUserData(previous);
    await this.lifecycle.saveLastIdentity(user);
    if (epoch === this.epoch) {
      this.lastUserId = user.userId;
      this.publish({ state: "AUTHENTICATED", user });
    }
  }
  private async failed(error: unknown, epoch: number, allowOfflineCache = false) {
    if (epoch !== this.epoch) return;
    const transient =
      error instanceof ApiError && ["network", "timeout", "server", "429"].includes(error.kind);
    if (!transient) {
      this.credential = undefined;
      try {
        await this.persist(() => this.vault.clear());
        const previous = this.lastUserId ?? this.snapshot.user?.userId;
        if (previous) await this.lifecycle.clearUserData(previous);
        await this.lifecycle.clearLastIdentity();
        this.lastUserId = undefined;
      } catch {
        this.publish({
          state: "SESSION_EXPIRED",
          error: "Không thể xóa phiên trong bộ nhớ an toàn. Hãy thử đăng xuất lại.",
        });
        return;
      }
    }
    if (epoch !== this.epoch) return;
    if (transient && allowOfflineCache) {
      try {
        const user = await this.lifecycle.readLastIdentity();
        if (user?.role === "STUDENT" && (await this.lifecycle.hasOfflineData(user.userId))) {
          this.credential = undefined;
          this.lastUserId = user.userId;
          this.publish({ state: "OFFLINE_CACHE", user, error: "Đang dùng dữ liệu đã đồng bộ lần gần nhất." });
          return;
        }
      } catch {
        // A locked or unavailable private cache never falls back to unauthenticated disk data.
      }
    }
    this.publish({
      state: transient ? "NETWORK_UNAVAILABLE" : "SESSION_EXPIRED",
      error: error instanceof ApiError ? error.message : "Không thể khôi phục phiên an toàn.",
    });
  }
  restore() {
    if (this.restoreFlight) return this.restoreFlight;
    this.restoreFlight = this.restoreOnce().finally(() => {
      this.restoreFlight = undefined;
    });
    return this.restoreFlight;
  }
  private async restoreOnce() {
    const epoch = ++this.epoch;
    this.publish({ state: "BOOTING" });
    try {
      const saved = await this.vault.read();
      if (epoch !== this.epoch) return;
      if (!saved) {
        this.publish({ state: "ANONYMOUS" });
        return;
      }
      const value: unknown = JSON.parse(saved);
      if (
        !value ||
        typeof value !== "object" ||
        !("sessionId" in value) ||
        !("refreshToken" in value) ||
        typeof value.sessionId !== "string" ||
        typeof value.refreshToken !== "string"
      )
        throw new ApiError("invalid");
      await this.accept(
        await this.api.request("/api/v1/auth/refresh", {
          method: "POST",
          body: { sessionId: value.sessionId, refreshToken: value.refreshToken },
        }),
        epoch,
      );
      await this.identity(epoch);
    } catch (error) {
      await this.failed(error, epoch, true);
    }
  }
  async login(email: string, password: string) {
    const epoch = ++this.epoch;
    this.publish({ state: "AUTHENTICATING" });
    try {
      await this.accept(
        await this.api.request("/api/v1/auth/login", { method: "POST", body: { email, password } }),
        epoch,
      );
      await this.identity(epoch);
    } catch (error) {
      await this.failed(error, epoch);
      if (epoch === this.epoch && error instanceof ApiError && error.status === 401)
        this.publish({
          state: "ANONYMOUS",
          error: "Email hoặc mật khẩu không đúng, hoặc tài khoản không còn khả dụng.",
        });
    }
  }
  async socialLogin(
    provider: "google" | "apple",
    idToken: string,
    clientProfile?: { firstName?: string; lastName?: string },
  ) {
    const epoch = ++this.epoch;
    this.publish({ state: "AUTHENTICATING" });
    try {
      await this.accept(
        await this.api.request(`/api/v1/auth/social/${provider}`, {
          method: "POST",
          body: { idToken, ...(clientProfile ? { clientProfile } : {}) },
        }),
        epoch,
      );
      await this.identity(epoch);
    } catch (error) {
      await this.failed(error, epoch);
      if (epoch === this.epoch && error instanceof ApiError) {
        if (error.status === 409) {
          this.publish({
            state: "ANONYMOUS",
            error: "Email này đã tồn tại trên AILSS. Vui lòng đăng nhập bằng mật khẩu để liên kết tài khoản.",
          });
        } else {
          this.publish({
            state: "ANONYMOUS",
            error: `Đăng nhập ${provider === "google" ? "Google" : "Apple"} không thành công.`,
          });
        }
      }
      throw error;
    }
  }
  private refresh() {
    if (this.flight) return this.flight;
    const epoch = this.epoch;
    this.flight = (async () => {
      if (!this.credential) throw new ApiError("401", 401);
      const { sessionId, refreshToken } = this.credential;
      try {
        await this.accept(
          await this.api.request("/api/v1/auth/refresh", {
            method: "POST",
            body: { sessionId, refreshToken },
          }),
          epoch,
        );
        await this.identity(epoch);
      } catch (error) {
        await this.failed(error, epoch);
        throw error;
      }
    })().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }
  async request(path: string, options: RequestOptions = {}) {
    const epoch = this.epoch;
    const used = this.credential?.accessToken;
    if (!used) throw new ApiError("401", 401);
    try {
      const result = await this.api.request(path, { ...options, token: used });
      if (epoch !== this.epoch) throw new ApiError("cancelled");
      return result;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || epoch !== this.epoch) throw error;
      if (used === this.credential?.accessToken) await this.refresh();
      if (epoch !== this.epoch || !this.credential) throw new ApiError("cancelled");
      try {
        const result = await this.api.request(path, { ...options, token: this.credential.accessToken });
        if (epoch !== this.epoch) throw new ApiError("cancelled");
        return result;
      } catch (retry) {
        if (retry instanceof ApiError && retry.status === 401) await this.failed(retry, epoch);
        throw retry;
      }
    }
  }
  async revalidate() {
    if (this.snapshot.state === "OFFLINE_CACHE") {
      await this.restore();
      return;
    }
    if (this.snapshot.state !== "AUTHENTICATED") return;
    const epoch = this.epoch;
    try {
      const user = profile(await this.request("/api/v1/me"));
      if (epoch === this.epoch) this.publish({ state: "AUTHENTICATED", user });
    } catch (error) {
      await this.failed(error, epoch);
    }
  }
  async logout() {
    const accessToken = this.credential?.accessToken;
    const userId = this.snapshot.user?.userId ?? this.lastUserId;
    const epoch = ++this.epoch;
    this.credential = undefined;
    this.publish({ state: "ANONYMOUS" });
    try {
      await this.persist(() => this.vault.clear());
      if (userId) await this.lifecycle.clearUserData(userId);
      await this.lifecycle.clearLastIdentity();
      this.lastUserId = undefined;
    } catch (error) {
      if (epoch !== this.epoch) throw error;
      this.publish({ state: "ANONYMOUS", error: "Không thể xóa an toàn dữ liệu học tập trên thiết bị." });
      throw error;
    }
    try {
      if (accessToken) await this.api.request("/api/v1/auth/logout", { method: "POST", token: accessToken });
    } catch (error) {
      if (epoch !== this.epoch) throw error;
      this.publish({
        state: "ANONYMOUS",
        error: "Đã xóa phiên trên thiết bị. Chưa xác nhận được thu hồi trên máy chủ.",
        revocationStatus: "REVOCATION_UNCONFIRMED",
      });
      throw error;
    }
  }
}
