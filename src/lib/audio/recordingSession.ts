/**
 * 录音会话持久化（sessionStorage，标签页级别隔离）
 *
 * 解决的核心问题：页面刷新后 JS 内存全部丢失，需要知道"刷新前是否在录音"。
 *
 * 行为规则：
 * - 会中页面刷新 → 检测到待恢复会话 → 重新请求权限 → 恢复录制
 * - 其他页面刷新 → 组件主动清除会话 → 不恢复
 * - 路由切换（非刷新）→ 全局单例仍存活，会话不受影响
 */

const SESSION_KEY = 'audio_recording_session';

export interface RecordingSessionData {
  /** 正在录制的会议ID */
  meetingId: string;
  /** 录制开始时间戳 */
  startedAt: number;
}

export const recordingSession = {
  /**
   * 保存录音会话（录制成功启动后调用）
   */
  save(meetingId: string): void {
    try {
      const data: RecordingSessionData = {
        meetingId,
        startedAt: Date.now(),
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save recording session:', e);
    }
  },

  /**
   * 获取录音会话
   */
  get(): RecordingSessionData | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw) as RecordingSessionData;

      // 超过24小时视为过期
      if (Date.now() - data.startedAt > 24 * 60 * 60 * 1000) {
        this.clear();
        return null;
      }

      return data;
    } catch (e) {
      console.error('Failed to get recording session:', e);
      return null;
    }
  },

  /**
   * 检查是否有待恢复的录音会话
   * @param meetingId 可选，指定检查特定会议
   */
  hasPendingSession(meetingId?: string): boolean {
    const session = this.get();
    if (!session) return false;
    if (meetingId) return session.meetingId === meetingId;
    return true;
  },

  /**
   * 清除录音会话（录制停止、或非会中页面加载时调用）
   */
  clear(): void {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      console.error('Failed to clear recording session:', e);
    }
  },
};
