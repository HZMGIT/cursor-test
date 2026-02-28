import { globalAudioManager } from '@/lib/audio/GlobalAudioManager';
import { globalWebSocketManager } from '@/lib/websocket/GlobalWebSocketManager';
import { webSocketMonitor } from '@/lib/websocket/webSocketMonitor';

let beforeUnloadGuardInstalled = false;

const GLOBAL_RECORDING_LOCK_KEY = 'global_recording_lock_v1';
export const GLOBAL_RECORDING_LOCK_TTL_MS = 12000;
const START_RECORDING_MUTEX_KEY = 'start_recording_mutex_v1';
const START_RECORDING_MUTEX_TTL_MS = 10000;
const RECENT_STOP_MARK_KEY = 'recent_recording_stop_mark_v1';

export const setGlobalRecordingLock = (meetingId?: string) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      GLOBAL_RECORDING_LOCK_KEY,
      JSON.stringify({
        meetingId: meetingId ?? globalWebSocketManager.getMeetingId() ?? '',
        updatedAt: Date.now(),
      })
    );
  } catch {
    // ignore
  }
};

export const clearGlobalRecordingLock = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(GLOBAL_RECORDING_LOCK_KEY);
  } catch {
    // ignore
  }
};

export const hasRecentGlobalRecordingLock = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(GLOBAL_RECORDING_LOCK_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { updatedAt?: number };
    if (!parsed?.updatedAt) return false;
    return Date.now() - parsed.updatedAt < GLOBAL_RECORDING_LOCK_TTL_MS;
  } catch {
    return false;
  }
};

export const clearStaleGlobalRecordingLockIfSafe = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    if (!hasRecentGlobalRecordingLock()) return false;
    // 仅在“本标签页不在录制 + 全局连接不活跃 + monitor 无活跃连接”时清理锁
    const wsState = globalWebSocketManager.getConnectionState();
    const hasWsActive = wsState === 'connected' || wsState === 'reconnecting';
    const hasAudioActive = globalAudioManager.isRecordingActive();
    const hasMonitorActive = webSocketMonitor.hasActiveConnection();
    if (!hasWsActive && !hasAudioActive && !hasMonitorActive) {
      clearGlobalRecordingLock();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};

export const setRecentStopMark = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      RECENT_STOP_MARK_KEY,
      JSON.stringify({ updatedAt: Date.now() })
    );
  } catch {
    // ignore
  }
};

export const clearRecentStopMark = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(RECENT_STOP_MARK_KEY);
  } catch {
    // ignore
  }
};

const clearStartRecordingMutexForce = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(START_RECORDING_MUTEX_KEY);
  } catch {
    // ignore
  }
};

export const hardResetCrossTabRecordingState = () => {
  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      '[recording] hard reset before cleanup, monitor stats:',
      webSocketMonitor.getStats()
    );
  }
  clearGlobalRecordingLock();
  clearStartRecordingMutexForce();
  // 用户明确结束会议后，强制清空 monitor 记录，避免残留状态误拦截下次创建
  webSocketMonitor.cleanup();
  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      '[recording] hard reset after cleanup, monitor stats:',
      webSocketMonitor.getStats()
    );
  }
};

export const acquireStartRecordingMutex = (): string | null => {
  if (typeof window === 'undefined') return 'server';

  const now = Date.now();
  const ownerId = `owner_${now}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    const raw = localStorage.getItem(START_RECORDING_MUTEX_KEY);
    if (raw) {
      const current = JSON.parse(raw) as { ownerId?: string; updatedAt?: number };
      if (
        current?.ownerId &&
        current?.updatedAt &&
        now - current.updatedAt < START_RECORDING_MUTEX_TTL_MS
      ) {
        return null;
      }
    }
  } catch {
    // ignore and continue try-lock
  }

  try {
    localStorage.setItem(
      START_RECORDING_MUTEX_KEY,
      JSON.stringify({ ownerId, updatedAt: now })
    );
    const confirmRaw = localStorage.getItem(START_RECORDING_MUTEX_KEY);
    if (!confirmRaw) return null;
    const confirm = JSON.parse(confirmRaw) as { ownerId?: string };
    return confirm.ownerId === ownerId ? ownerId : null;
  } catch {
    return null;
  }
};

export const releaseStartRecordingMutex = (ownerId: string | null) => {
  if (typeof window === 'undefined' || !ownerId) return;
  try {
    const raw = localStorage.getItem(START_RECORDING_MUTEX_KEY);
    if (!raw) return;
    const current = JSON.parse(raw) as { ownerId?: string };
    if (current.ownerId === ownerId) {
      localStorage.removeItem(START_RECORDING_MUTEX_KEY);
    }
  } catch {
    // ignore
  }
};

export const installGlobalBeforeUnloadGuard = (
  hasOngoingRecordingSession: () => boolean
) => {
  if (beforeUnloadGuardInstalled || typeof window === 'undefined') return;

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    const hasOngoingSession = hasOngoingRecordingSession();
    if (!hasOngoingSession) return;

    event.preventDefault();
    event.returnValue = '';
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  beforeUnloadGuardInstalled = true;
};
