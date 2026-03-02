import { globalAudioManager } from '@/lib/audio/GlobalAudioManager';
import { recordingSession } from '@/lib/audio/recordingSession';
import { globalWebSocketManager } from '@/lib/websocket/GlobalWebSocketManager';
import { webSocketMonitor } from '@/lib/websocket/webSocketMonitor';
import {
  hardResetCrossTabRecordingState,
  hasRecentGlobalRecordingLock,
  setRecentStopMark,
} from './crossTabState';
import {
  isGlobalStartInProgress,
  resetGlobalStartState,
} from './sharedState';

export const hasOngoingRecordingSession = (): boolean => {
  const state = globalWebSocketManager.getConnectionState();
  return (
    globalAudioManager.isRecordingActive() ||
    state === 'connected' ||
    state === 'reconnecting' ||
    isGlobalStartInProgress() ||
    hasRecentGlobalRecordingLock()
  );
};

/**
 * 仅用于 beforeunload 守卫的“当前标签页”判定：
 * - 不依赖 localStorage 全局锁，避免复制标签页时误弹二次提示。
 * - 保留本标签页真实录制/连接中的保护能力。
 */
export const hasOngoingRecordingSessionInThisTab = (): boolean => {
  const state = globalWebSocketManager.getConnectionState();
  return (
    globalAudioManager.isRecordingActive() ||
    state === 'connected' ||
    state === 'reconnecting' ||
    isGlobalStartInProgress()
  );
};

export const stopRecordingIfActive = (): { hadActiveSession: boolean } => {
  // hasOngoingRecordingSession 不包含 webSocketMonitor 残留态。
  // 为避免“会议结束后 monitor 仍残留导致下次误判其他标签页在录音”，
  // 这里把跨标签残留态也纳入是否执行清理的判断。
  const hasMonitorResidual =
    webSocketMonitor.hasActiveConnection() ||
    webSocketMonitor.getStats().totalConnections > 0;
  const hadActiveSession = hasOngoingRecordingSession() || hasMonitorResidual;
  if (!hadActiveSession) {
    return { hadActiveSession: false };
  }

  globalAudioManager.stopRecording();
  globalAudioManager.releasePermissions();
  globalWebSocketManager.disconnect();
  webSocketMonitor.disconnect();
  recordingSession.clear();
  hardResetCrossTabRecordingState();
  setRecentStopMark();
  resetGlobalStartState();

  return { hadActiveSession: true };
};
