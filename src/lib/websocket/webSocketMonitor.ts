interface ConnectionRecord {
  timestamp: number;
  status: "connected" | "disconnected";
  lastActive: number;
  tabId: string;
  meetingId?: string;
}

class SimpleWebSocketMonitor {
  private static readonly STORAGE_KEY = "websocket_connections";
  private static readonly TIMEOUT_MS = 30000; // 30秒超时
  private static readonly ACTIVE_THRESHOLD_MS = 5000; // 5秒内活跃才视为有效
  private static cleanupTimer: NodeJS.Timeout | null = null;
  private static isInitialized = false;
  // 保存事件处理器引用，以便 cleanup 时移除
  private static beforeUnloadHandler: (() => void) | null = null;
  private static visibilityChangeHandler: (() => void) | null = null;

  // 初始化
  static init(): void {
    if (this.isInitialized) return;

    this.isInitialized = true;
    this.startCleanupTimer();

    // 页面卸载时清理当前标签页
    this.beforeUnloadHandler = () => {
      this.disconnect();
    };
    window.addEventListener("beforeunload", this.beforeUnloadHandler);

    // 页面可见性变化时仅做清理，不再“续命”连接记录。
    // 避免异常路径残留的 connected 记录被长期维持，导致误判“其他标签页正在录音”。
    this.visibilityChangeHandler = () => {
      if (document.visibilityState === "visible") {
        this.cleanupExpiredConnections();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);
  }

  /**
   * 启动定时清理
   */
  private static startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredConnections();
    }, 10000); // 每10秒清理一次
  }

  /**
   * 当前标签页连接到WebSocket
   */
  static connect(meetingId?: string): void {
    this.init();

    const tabId = this.getTabId();
    const connections = this.getConnections();

    // 清理过期连接
    this.cleanupExpiredConnections();

    // 添加或更新连接记录
    connections[tabId] = {
      timestamp: Date.now(),
      lastActive: Date.now(),
      status: "connected",
      tabId,
      meetingId,
    };

    this.saveConnections(connections);
    console.log(`WebSocketMonitor: Tab ${tabId} connected`, { meetingId });
  }

  /**
   * 当前标签页断开WebSocket
   */
  static disconnect(): void {
    const tabId = this.getTabId();
    const connections = this.getConnections();

    if (connections[tabId]) {
      connections[tabId] = {
        ...connections[tabId],
        status: "disconnected",
        lastActive: Date.now(),
      };
      this.saveConnections(connections);
      console.log(`WebSocketMonitor: Tab ${tabId} disconnected`);
    }
  }

  /**
   * 更新连接活跃时间
   *
   * 仅对当前标签页已存在且状态为 "connected" 的记录更新 lastActive。
   * 不会自动创建新记录或更新 "disconnected" 记录，
   * 避免 visibilitychange 等事件触发后产生幽灵 "connected" 记录。
   */
  static updateActiveTime(meetingId?: string): void {
    const tabId = this.getTabId();
    const connections = this.getConnections();

    const record = connections[tabId];

    // 仅更新已连接状态的记录
    if (record && record.status === "connected") {
      record.lastActive = Date.now();
      if (meetingId) {
        record.meetingId = meetingId;
      }
      this.saveConnections(connections);
    }
    // 不存在记录或已断开 → 不做任何操作
    // 新记录只应通过 webSocketMonitor.connect(meetingId) 创建
  }

  /**
   * 检查是否有任何标签页连接了WebSocket
   */
  static hasActiveConnection(): boolean {
    this.cleanupExpiredConnections();

    const connections = this.getConnections();
    const now = Date.now();
    // 用更宽松的窗口做“全局单连接”判定，避免后台页签节流导致 5 秒误判
    const lockValidWindowMs = this.TIMEOUT_MS;

    // 查找所有活跃连接（在有效窗口内）
    for (const record of Object.values(connections)) {
      if (
        record.status === "connected" &&
        now - record.lastActive < lockValidWindowMs
      ) {
        console.log("WebSocketMonitor: Found active connection", {
          tabId: record.tabId,
          lastActive: record.lastActive,
          age: now - record.lastActive,
        });
        return true;
      }
    }

    console.log("WebSocketMonitor: No active connections found");
    return false;
  }

  /**
   * 检查当前标签页是否连接了WebSocket
   */
  static hasConnectionInThisTab(): boolean {
    const tabId = this.getTabId();
    const connections = this.getConnections();
    const record = connections[tabId];
    const now = Date.now();
    const lockValidWindowMs = this.TIMEOUT_MS;

    if (!record) {
      console.log("WebSocketMonitor: No record found for this tab", tabId);
      return false;
    }

    const isActive =
      record.status === "connected" &&
      now - record.lastActive < lockValidWindowMs;

    console.log("WebSocketMonitor: Checking connection in this tab", {
      tabId,
      status: record.status,
      lastActive: record.lastActive,
      age: now - record.lastActive,
      isActive,
    });

    if (!isActive && record.status === "connected") {
      // 标记为不活跃
      record.status = "disconnected";
      this.saveConnections(connections);
    }

    return isActive;
  }

  /**
   * 清理过期连接
   */
  static cleanupExpiredConnections(): void {
    const connections = this.getConnections();
    const now = Date.now();
    let changed = false;

    for (const [tabId, record] of Object.entries(connections)) {
      // 清理超过超时时间的记录
      if (now - record.lastActive > this.TIMEOUT_MS) {
        delete connections[tabId];
        changed = true;
        console.log("WebSocketMonitor: Cleaned expired connection", tabId);
      }
    }

    if (changed) {
      this.saveConnections(connections);
    }
  }

  /**
   * 自愈清理：仅用于“点击开始录制时”的一次性校验。
   * 当 connected 记录长时间未刷新时，将其移除，降低脏状态导致的误拦截概率。
   */
  static forceCleanupLikelyStaleConnections(maxIdleMs: number): void {
    const connections = this.getConnections();
    const now = Date.now();
    let changed = false;

    for (const [tabId, record] of Object.entries(connections)) {
      if (record.status !== "connected") continue;
      if (now - record.lastActive > maxIdleMs) {
        delete connections[tabId];
        changed = true;
        console.log("WebSocketMonitor: Force cleaned likely stale connection", {
          tabId,
          age: now - record.lastActive,
          maxIdleMs,
        });
      }
    }

    if (changed) {
      this.saveConnections(connections);
    }
  }

  /**
   * 获取当前标签页ID（更稳定的版本）
   */
  private static getTabId(): string {
    // 尝试从sessionStorage获取稳定的标签页ID
    let tabId = sessionStorage.getItem("websocket_tab_id");

    if (!tabId) {
      // 使用更稳定的ID生成方式
      const seed = Math.random().toString(36).substr(2, 9);
      tabId = `tab_${seed}`;
      sessionStorage.setItem("websocket_tab_id", tabId);
      console.log("WebSocketMonitor: Generated new tab ID", tabId);
    }

    return tabId;
  }

  /**
   * 获取所有连接
   */
  private static getConnections(): Record<string, ConnectionRecord> {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (!data) return {};

      const parsed = JSON.parse(data);
      // 确保数据格式正确
      return Object.entries(parsed).reduce(
        (acc, [key, value]: [string, any]) => {
          if (value && typeof value === "object" && "lastActive" in value) {
            acc[key] = value as ConnectionRecord;
          }
          return acc;
        },
        {} as Record<string, ConnectionRecord>,
      );
    } catch (error) {
      console.error("Failed to get connections:", error);
      return {};
    }
  }

  /**
   * 保存连接
   */
  private static saveConnections(
    connections: Record<string, ConnectionRecord>,
  ): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(connections));
    } catch (error) {
      console.error("Failed to save connections:", error);
    }
  }

  /**
   * 获取连接状态统计
   */
  static getStats(): {
    totalConnections: number;
    activeConnections: number;
    connections: Array<ConnectionRecord>;
  } {
    const connections = this.getConnections();
    const now = Date.now();
    const activeConnections = Object.values(connections).filter(
      (record) =>
        record.status === "connected" &&
        now - record.lastActive < this.ACTIVE_THRESHOLD_MS,
    ).length;

    return {
      totalConnections: Object.keys(connections).length,
      activeConnections,
      connections: Object.values(connections),
    };
  }

  /**
   * 清理所有连接
   */
  static cleanup(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    sessionStorage.removeItem("websocket_tab_id");
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    // 移除事件监听器，防止 cleanup 后 re-init 导致监听器叠加
    if (this.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.visibilityChangeHandler) {
      document.removeEventListener("visibilitychange", this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
    }
    this.isInitialized = false;
  }
}

// 导出静态方法
export const webSocketMonitor = {
  connect: (meetingId?: string) => SimpleWebSocketMonitor.connect(meetingId),
  disconnect: () => SimpleWebSocketMonitor.disconnect(),
  updateActiveTime: (meetingId?: string) =>
    SimpleWebSocketMonitor.updateActiveTime(meetingId),
  hasActiveConnection: () => SimpleWebSocketMonitor.hasActiveConnection(),
  hasConnectionInThisTab: () => SimpleWebSocketMonitor.hasConnectionInThisTab(),
  cleanup: () => SimpleWebSocketMonitor.cleanup(),
  getStats: () => SimpleWebSocketMonitor.getStats(),
  cleanupExpiredConnections: () =>
    SimpleWebSocketMonitor.cleanupExpiredConnections(),
  forceCleanupLikelyStaleConnections: (maxIdleMs: number) =>
    SimpleWebSocketMonitor.forceCleanupLikelyStaleConnections(maxIdleMs),
};
