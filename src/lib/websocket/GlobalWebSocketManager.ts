import { webSocketMonitor } from '@/lib/websocket/webSocketMonitor';

export type ConnectionState = 'disconnected' | 'connected' | 'reconnecting' | 'failed';

class GlobalWebSocketManager {
  private static instance: GlobalWebSocketManager;
  private webSocket: WebSocket | null = null;
  private connectionUrl: string | null = null;
  private isManualDisconnect = false;
  private currentMeetingId: string | null = null;

  // 连接状态
  private _connectionState: ConnectionState = 'disconnected';

  // 指数退避重连参数
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly baseReconnectDelay = 1000; // 1秒
  private readonly maxReconnectDelay = 30000; // 30秒
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly connectTimeoutMs = 8000; // 8秒连接超时

  // ====== 心跳 / 网络健康检测 ======
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatIntervalMs = 5000; // 每 5 秒检查一次
  /**
   * 允许的最大缓冲区字节数（64KB ≈ 10 个音频包）。
   * 如果 bufferedAmount 持续超过此值，说明数据无法发出，连接可能已死。
   */
  private readonly maxBufferedAmount = 64 * 1024;
  /** bufferedAmount 连续超标次数 */
  private bufferedAmountStaleCount = 0;
  /** 连续超标多少次后判定连接已死 */
  private readonly maxStaleCount = 3;

  // 网络事件处理器引用（用于 removeEventListener）
  private offlineHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;

  // 事件监听器
  private openListeners: ((event: Event) => void)[] = [];
  private closeListeners: ((event: CloseEvent) => void)[] = [];
  private messageListeners: ((event: MessageEvent) => void)[] = [];
  private errorListeners: ((event: Event) => void)[] = [];

  // 连接状态订阅者（详细状态）
  private stateSubscribers: Set<(state: ConnectionState) => void> = new Set();

  private constructor() {}

  static getInstance(): GlobalWebSocketManager {
    if (!GlobalWebSocketManager.instance) {
      GlobalWebSocketManager.instance = new GlobalWebSocketManager();
    }
    return GlobalWebSocketManager.instance;
  }

  // ==================== 连接管理 ====================

  connect(url: string): WebSocket {
    // 检查是否是同一个 URL 且已经连接
    if (
      this.webSocket &&
      this.connectionUrl === url &&
      this.webSocket.readyState === WebSocket.OPEN
    ) {
      console.log('Reusing existing WebSocket connection');
      return this.webSocket;
    }

    // 如果正在连接中：
    // - 同 URL：复用现有连接
    // - 不同 URL：说明 meeting 已切换，强制关闭旧连接并重建
    if (this.webSocket && this.webSocket.readyState === WebSocket.CONNECTING) {
      if (this.connectionUrl === url) {
        console.log('WebSocket is already connecting (same URL), reusing');
        return this.webSocket;
      }
      console.warn('WebSocket is connecting to old URL, recreating with new URL', {
        from: this.connectionUrl,
        to: url,
      });
      this.closeWebSocketSilently();
    }

    // 如果已有连接，静默关闭（不触发旧 socket 的 onclose 回调）
    if (this.webSocket) {
      this.closeWebSocketSilently();
    }

    console.log('Connecting to WebSocket:', url);
    this.connectionUrl = url;
    this.isManualDisconnect = false;

    // 仅在非重连状态时切换到 reconnecting（重连中已经是该状态）
    if (this._connectionState !== 'reconnecting') {
      this.setConnectionState('reconnecting');
    }

    try {
      this.webSocket = new WebSocket(url);
      this.startConnectTimeoutWatchdog();

      this.webSocket.onopen = (event) => {
        console.log('WebSocket connected');
        this.clearConnectTimeoutWatchdog();
        // 连接成功，重置重连计数和缓冲区检测
        this.reconnectAttempts = 0;
        this.bufferedAmountStaleCount = 0;
        this.setConnectionState('connected');
        // 连接建立后立即写入跨页签连接记录
        webSocketMonitor.connect(this.currentMeetingId ?? undefined);
        webSocketMonitor.updateActiveTime(this.currentMeetingId ?? undefined);
        this.startHeartbeat();
        this.registerNetworkListeners();
        this.openListeners.forEach((listener) => listener(event));
      };

      this.webSocket.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.clearConnectTimeoutWatchdog();
        this.closeListeners.forEach((listener) => listener(event));

        if (!this.isManualDisconnect) {
          // 非手动断开 → 启动指数退避重连
          this.scheduleReconnect();
        } else {
          this.setConnectionState('disconnected');
        }
      };

      this.webSocket.onmessage = (event) => {
        this.messageListeners.forEach((listener) => listener(event));
      };

      this.webSocket.onerror = (event) => {
        console.error('WebSocket error:', event);
        this.errorListeners.forEach((listener) => listener(event));
      };

      return this.webSocket;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      throw error;
    }
  }

  /**
   * 指数退避重连调度
   */
  private scheduleReconnect(): void {
    // 已有待执行的重连任务时不重复调度，避免并发定时器打乱计数
    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        `WebSocket: 重连失败，已达最大重试次数 (${this.maxReconnectAttempts})`
      );
      this.webSocket = null;
      this.setConnectionState('failed');
      return;
    }

    this.webSocket = null;
    this.setConnectionState('reconnecting');

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;

    console.log(
      `WebSocket: ${delay}ms 后进行第 ${this.reconnectAttempts}/${this.maxReconnectAttempts} 次重连`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.connectionUrl && !this.isManualDisconnect) {
        try {
          this.connect(this.connectionUrl);
        } catch (error) {
          console.error('WebSocket reconnect failed:', error);
          // connect 构造失败时继续调度下一次重连
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * 手动重连（用于连接失败后用户主动触发）
   */
  manualReconnect(): void {
    if (!this.connectionUrl) {
      console.warn('WebSocket: 没有可用的连接地址，无法重连');
      return;
    }

    // 清除已有的重连定时器
    this.clearReconnectTimer();

    // 重置重连状态
    this.reconnectAttempts = 0;
    this.isManualDisconnect = false;

    // 静默关闭旧连接
    if (this.webSocket) {
      this.closeWebSocketSilently();
    }

    this.setConnectionState('reconnecting');
    this.connect(this.connectionUrl);
  }

  /**
   * 内部静默关闭 WebSocket（清除事件处理器，防止触发 onclose 回调）
   */
  private closeWebSocketSilently(): void {
    this.stopHeartbeat();
    this.clearConnectTimeoutWatchdog();

    if (this.webSocket) {
      const ws = this.webSocket;
      ws.onopen = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
      this.webSocket = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startConnectTimeoutWatchdog(): void {
    this.clearConnectTimeoutWatchdog();
    this.connectTimeoutTimer = setTimeout(() => {
      if (this.webSocket && this.webSocket.readyState === WebSocket.CONNECTING) {
        console.warn(
          `WebSocket connect timeout (${this.connectTimeoutMs}ms), force reconnect scheduling`
        );
        // 某些线上环境中，CONNECTING 卡死时 close() 未必及时触发 onclose。
        // 这里主动走一次重连调度，避免只能靠刷新恢复。
        this.closeWebSocketSilently();
        this.scheduleReconnect();
      }
    }, this.connectTimeoutMs);
  }

  private clearConnectTimeoutWatchdog(): void {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  // ==================== 心跳 / 网络健康检测 ====================

  /**
   * 启动定时心跳检测：
   *  - 浏览器 offline → 立即判定断连
   *  - bufferedAmount 持续增长 → 数据发不出去 → 判定断连
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.bufferedAmountStaleCount = 0;

    this.heartbeatTimer = setInterval(() => {
      // 下沉跨页签活跃心跳到全局连接管理器，避免依赖页面 hook 是否挂载
      webSocketMonitor.updateActiveTime(this.currentMeetingId ?? undefined);
      this.checkConnectionHealth();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 周期性连接健康检查
   */
  private checkConnectionHealth(): void {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;

    // 1. 浏览器报告离线
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.warn('WebSocket heartbeat: browser reports offline');
      this.handleConnectionLost();
      return;
    }

    // 2. 缓冲区积压检测
    //    正常情况下，音频数据发送后 bufferedAmount 应快速归零。
    //    如果持续超过阈值，说明 TCP 层已无法真正发送数据。
    const buffered = this.webSocket.bufferedAmount;
    if (buffered > this.maxBufferedAmount) {
      this.bufferedAmountStaleCount++;
      console.warn(
        `WebSocket heartbeat: bufferedAmount=${buffered}, stale count=${this.bufferedAmountStaleCount}/${this.maxStaleCount}`
      );
      if (this.bufferedAmountStaleCount >= this.maxStaleCount) {
        console.error(
          'WebSocket heartbeat: connection appears dead (buffer not draining)'
        );
        this.handleConnectionLost();
      }
    } else {
      // 缓冲区正常 → 重置计数
      this.bufferedAmountStaleCount = 0;
    }
  }

  /**
   * 检测到连接实际已断开（网络不可达 / 缓冲区积压），
   * 主动关闭并触发重连流程
   */
  private handleConnectionLost(): void {
    this.stopHeartbeat();
    this.closeWebSocketSilently();
    // 启动指数退避重连
    this.scheduleReconnect();
  }

  /**
   * 监听浏览器 online/offline 事件，
   * 配合心跳做双重网络断连检测
   */
  private registerNetworkListeners(): void {
    if (this.offlineHandler) return; // 已注册

    this.offlineHandler = () => {
      console.warn('WebSocket: network offline event');
      if (
        this._connectionState === 'connected' &&
        this.webSocket &&
        this.webSocket.readyState === WebSocket.OPEN
      ) {
        this.handleConnectionLost();
      }
    };

    this.onlineHandler = () => {
      console.log('WebSocket: network online event');
      // 网络恢复 → 如果正在重连或已失败，立即尝试重连
      if (
        this._connectionState === 'reconnecting' ||
        this._connectionState === 'failed'
      ) {
        this.clearReconnectTimer();
        this.isManualDisconnect = false;
        if (this.connectionUrl) {
          console.log('WebSocket: network restored, attempting reconnection');
          this.setConnectionState('reconnecting');
          try {
            this.connect(this.connectionUrl);
          } catch (error) {
            console.error('WebSocket: reconnect on online failed', error);
            this.scheduleReconnect();
          }
        }
      }
    };

    window.addEventListener('offline', this.offlineHandler);
    window.addEventListener('online', this.onlineHandler);
  }

  private unregisterNetworkListeners(): void {
    if (this.offlineHandler) {
      window.removeEventListener('offline', this.offlineHandler);
      this.offlineHandler = null;
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
  }

  // ==================== 数据发送 ====================

  private syncStateWithReadyState(): void {
    if (
      this.webSocket &&
      this.webSocket.readyState === WebSocket.OPEN &&
      this._connectionState !== 'connected'
    ) {
      console.warn(
        `WebSocket state self-heal: ${this._connectionState} -> connected (readyState=OPEN)`
      );
      this.setConnectionState('connected');
    }
  }

  send(data: string | ArrayBuffer | Blob | ArrayBufferView): boolean {
    this.syncStateWithReadyState();
    // 守卫 1：只有在 'connected' 状态下才允许发送
    if (this._connectionState !== 'connected') return false;

    // 守卫 2：WebSocket 实例存在且 readyState 为 OPEN
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      return false;
    }

    // 守卫 3：浏览器报告离线 → 主动触发断连检测
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.warn('WebSocket send: browser is offline, triggering connection lost');
      this.handleConnectionLost();
      return false;
    }

    try {
      this.webSocket.send(data);
      return true;
    } catch (error) {
      console.error('Failed to send data:', error);
      return false;
    }
  }

  // ==================== 断开连接 ====================

  disconnect(): void {
    this.isManualDisconnect = true;
    this.clearReconnectTimer();
    this.clearConnectTimeoutWatchdog();
    this.reconnectAttempts = 0;

    // 静默关闭：清除事件处理器防止 onclose 异步触发时重复通知
    this.closeWebSocketSilently();
    this.unregisterNetworkListeners();
    webSocketMonitor.disconnect();

    // 保留 connectionUrl 以支持后续 manualReconnect
    this.setConnectionState('disconnected');
  }

  // ==================== 状态查询 ====================

  isConnected(): boolean {
    this.syncStateWithReadyState();
    return (
      this._connectionState === 'connected' &&
      this.webSocket !== null &&
      this.webSocket.readyState === WebSocket.OPEN
    );
  }

  getConnectionState(): ConnectionState {
    return this._connectionState;
  }

  // ==================== MeetingId 管理（全局持久化，路由切换不丢失） ====================

  setMeetingId(meetingId: string): void {
    this.currentMeetingId = meetingId;
  }

  getMeetingId(): string | null {
    return this.currentMeetingId;
  }

  // ==================== 事件监听器 ====================

  addOpenListener(listener: (event: Event) => void): void {
    this.openListeners.push(listener);
  }

  removeOpenListener(listener: (event: Event) => void): void {
    const index = this.openListeners.indexOf(listener);
    if (index > -1) {
      this.openListeners.splice(index, 1);
    }
  }

  addCloseListener(listener: (event: CloseEvent) => void): void {
    this.closeListeners.push(listener);
  }

  removeCloseListener(listener: (event: CloseEvent) => void): void {
    const index = this.closeListeners.indexOf(listener);
    if (index > -1) {
      this.closeListeners.splice(index, 1);
    }
  }

  addMessageListener(listener: (event: MessageEvent) => void): void {
    this.messageListeners.push(listener);
  }

  removeMessageListener(listener: (event: MessageEvent) => void): void {
    const index = this.messageListeners.indexOf(listener);
    if (index > -1) {
      this.messageListeners.splice(index, 1);
    }
  }

  addErrorListener(listener: (event: Event) => void): void {
    this.errorListeners.push(listener);
  }

  removeErrorListener(listener: (event: Event) => void): void {
    const index = this.errorListeners.indexOf(listener);
    if (index > -1) {
      this.errorListeners.splice(index, 1);
    }
  }

  // ==================== 状态订阅 ====================

  /**
   * 订阅详细连接状态变化
   */
  subscribeToState(callback: (state: ConnectionState) => void): () => void {
    this.stateSubscribers.add(callback);

    setTimeout(() => {
      callback(this._connectionState);
    }, 0);

    return () => {
      this.stateSubscribers.delete(callback);
    };
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      console.log(`WebSocket state: ${this._connectionState} → ${state}`);
      this._connectionState = state;
      this.notifyStateChange(state);
    }
  }

  private notifyStateChange(state: ConnectionState): void {
    setTimeout(() => {
      this.stateSubscribers.forEach((callback) => {
        try {
          callback(state);
        } catch (error) {
          console.error('Error in state subscriber:', error);
        }
      });
    }, 0);
  }

}

export const globalWebSocketManager = GlobalWebSocketManager.getInstance();
