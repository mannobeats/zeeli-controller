/**
 * The one seam between the interface and a router. The GL.iNet transport talks to
 * oui-httpd and LuCI; the mock transport answers from memory. A plain-OpenWrt
 * transport implements the same surface, so screens never change.
 */
export interface Transport {
  /** A firmware module call: `call('clients', 'get_list')`. */
  call<T = unknown>(module: string, fn: string, args?: object, timeoutMs?: number): Promise<T>;
  /** A raw ubus call, used for OpenWrt settings (UCI, network, file exec). */
  ubus<T = unknown>(object: string, method: string, args?: object, timeoutMs?: number): Promise<T>;
  /**
   * Run an ACL-allowed command through LuCI's cgi-exec and return its output as text.
   * For output too large for ubus `file.exec`, which refuses anything over 4 MB.
   */
  execDirect(command: string, params?: string[], timeoutMs?: number): Promise<string>;
  /** AdGuard Home's HTTP API, which the router serves under /control/. */
  adguard<T = unknown>(path: string, init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown }): Promise<T>;
  upload(path: string, file: Blob, filename: string): Promise<void>;
  download(path: string, filename: string): Promise<Blob>;
  readonly session: Session;
}

export interface Session {
  signedIn(): boolean;
  login(password: string): Promise<void>;
  alive(): Promise<boolean>;
  logout(): Promise<void>;
  /** OpenWrt settings need a second sign-in on GL firmware (LuCI). */
  advancedUnlocked(): Promise<boolean>;
  unlockAdvanced(password: string): Promise<boolean>;
  onSignedOut(listener: () => void): () => void;
}
