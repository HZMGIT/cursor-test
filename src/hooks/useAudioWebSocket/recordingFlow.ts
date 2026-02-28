import type { MutableRefObject } from 'react';
import { globalAudioManager } from '@/lib/audio/GlobalAudioManager';
import { recordingSession } from '@/lib/audio/recordingSession';
import { globalWebSocketManager } from '@/lib/websocket/GlobalWebSocketManager';
import { webSocketMonitor } from '@/lib/websocket/webSocketMonitor';
import {
  acquireStartRecordingMutex,
  clearRecentStopMark,
  clearStaleGlobalRecordingLockIfSafe,
  GLOBAL_RECORDING_LOCK_TTL_MS,
  hasRecentGlobalRecordingLock,
  releaseStartRecordingMutex,
  setGlobalRecordingLock,
} from './crossTabState';
import {
  getGlobalStartMeetingId,
  isGlobalStartInProgress,
  resetGlobalStartState,
  setGlobalStartInProgress,
  setGlobalStartMeetingId,
} from './sharedState';
import type {
  AudioWebSocketCallbacks,
  StartRecordingOptions,
  StartRecordingResult,
} from './types';

interface ExecuteStartRecordingDeps {
  connectWebSocket: (meetingId: string) => void;
  setCurrentMeetingId: (meetingId: string) => void;
  meetingIdRef: MutableRefObject<string>;
  isStartingRef: MutableRefObject<boolean>;
  callbacksRef: MutableRefObject<AudioWebSocketCallbacks>;
  notifyOtherTabRecording: () => void;
  setMicrophonePermission: (
    permission: 'granted' | 'denied' | 'prompt' | 'unknown'
  ) => void;
}

export async function executeStartRecording(
  options: StartRecordingOptions,
  deps: ExecuteStartRecordingDeps
): Promise<StartRecordingResult> {
  const {
    connectWebSocket,
    setCurrentMeetingId,
    meetingIdRef,
    isStartingRef,
    callbacksRef,
    notifyOtherTabRecording,
    setMicrophonePermission,
  } = deps;
  const { meetingId: existingMeetingId, onMeetingCreate } = options;
  let mutexOwnerId: string | null = null;

  // 参数校验
  if (!existingMeetingId && !onMeetingCreate) {
    callbacksRef.current.onError?.('必须提供 meetingId 或 onMeetingCreate');
    return {
      started: false,
      retryable: false,
      reason: 'invalid-options',
    };
  }

  // 防止重复触发
  if (globalAudioManager.isRecordingActive()) {
    const activeMeetingId = globalWebSocketManager.getMeetingId();
    // 录制已在进行：
    // 1) 同会议：若仅 WebSocket 断开，允许借 startRecording 走一次补连
    // 2) 会议ID短暂未对齐（activeMeetingId 为空）：按当前传入会议ID对齐并补连
    if (
      existingMeetingId &&
      (!activeMeetingId || activeMeetingId === existingMeetingId)
    ) {
      if (!activeMeetingId) {
        globalWebSocketManager.setMeetingId(existingMeetingId);
        meetingIdRef.current = existingMeetingId;
        setCurrentMeetingId(existingMeetingId);
      }
      if (!globalWebSocketManager.isConnected()) {
        connectWebSocket(existingMeetingId);
      }
      return {
        started: true,
        retryable: false,
        reason: 'started',
      };
    }

    console.log('Recording is already active');
    return {
      started: false,
      retryable: false,
      reason: 'already-recording',
    };
  }
  // 全局并发保护：防止会前页与会中页同时触发 startRecording 导致重复请求权限
  if (isGlobalStartInProgress()) {
    console.log('Global startRecording is already in progress', {
      globalStartMeetingId: getGlobalStartMeetingId(),
      incomingMeetingId: existingMeetingId,
    });
    return {
      started: false,
      retryable: true,
      reason: 'already-starting',
    };
  }
  if (isStartingRef.current) {
    console.log('Recording is already starting');
    return {
      started: false,
      retryable: true,
      reason: 'already-starting',
    };
  }

  // 跨页签互斥：线上并发初始化时，只允许一个页签进入权限流程
  mutexOwnerId = acquireStartRecordingMutex();
  if (!mutexOwnerId) {
    console.log('startRecording mutex not acquired, skip this attempt');
    return {
      started: false,
      retryable: true,
      reason: 'mutex-not-acquired',
    };
  }

  setGlobalStartInProgress(true);
  isStartingRef.current = true;

  try {
    // ===== Step 1: 检查是否有其他活跃 WebSocket 连接 =====
    console.log('Checking for connections in other tabs...');
    const stats = webSocketMonitor.getStats();
    console.log('Current connection stats:', stats);

    // 复制浏览器页签场景下，初始化存在短暂时序差。
    // 在请求权限前做一个短窗口轮询重检（最多 2 秒），避免偶发误判导致再次弹权限。
    let hasConnectionInOtherTab = false;
    let hasRecentLock = false;
    for (let i = 0; i < 8; i++) {
      webSocketMonitor.cleanupExpiredConnections();
      webSocketMonitor.forceCleanupLikelyStaleConnections(
        GLOBAL_RECORDING_LOCK_TTL_MS
      );
      clearStaleGlobalRecordingLockIfSafe();
      const hasActiveConnection = webSocketMonitor.hasActiveConnection();
      const hasConnectionInThisTab = webSocketMonitor.hasConnectionInThisTab();
      hasRecentLock = hasRecentGlobalRecordingLock();
      hasConnectionInOtherTab =
        (hasActiveConnection && !hasConnectionInThisTab) || hasRecentLock;
      if (hasConnectionInOtherTab) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // 一次性自愈：仅在“命中占用但没有全局锁”时，尝试清理疑似脏 monitor 记录后再判定一次
    if (hasConnectionInOtherTab && !hasRecentLock) {
      webSocketMonitor.forceCleanupLikelyStaleConnections(
        GLOBAL_RECORDING_LOCK_TTL_MS
      );
      const hasActiveConnection = webSocketMonitor.hasActiveConnection();
      const hasConnectionInThisTab = webSocketMonitor.hasConnectionInThisTab();
      hasConnectionInOtherTab =
        (hasActiveConnection && !hasConnectionInThisTab) ||
        hasRecentGlobalRecordingLock();
    }

    // 统一兜底：若本标签页已无活跃会话且无全局锁仍被阻塞，
    // 做一次受限重清理后重判，覆盖手动 stop / SSE 自动结束等所有结束路径。
    if (
      hasConnectionInOtherTab &&
      !hasRecentLock &&
      !globalAudioManager.isRecordingActive() &&
      globalWebSocketManager.getConnectionState() === 'disconnected'
    ) {
      webSocketMonitor.cleanupExpiredConnections();
      webSocketMonitor.forceCleanupLikelyStaleConnections(0);
      clearStaleGlobalRecordingLockIfSafe();
      const hasActiveConnection = webSocketMonitor.hasActiveConnection();
      const hasConnectionInThisTab = webSocketMonitor.hasConnectionInThisTab();
      hasConnectionInOtherTab =
        (hasActiveConnection && !hasConnectionInThisTab) ||
        hasRecentGlobalRecordingLock();
    }

    console.log('Connection check result:', {
      hasActiveConnection: webSocketMonitor.hasActiveConnection(),
      hasConnectionInThisTab: webSocketMonitor.hasConnectionInThisTab(),
      hasConnectionInOtherTab,
    });

    if (hasConnectionInOtherTab) {
      notifyOtherTabRecording();
      return {
        started: false,
        retryable: false,
        reason: 'active-connection-exists',
      };
    }

    // ===== Step 2: 请求麦克风 + 屏幕共享权限 =====
    const permResult = await globalAudioManager.requestPermissions();

    if (!permResult.micGranted) {
      // 麦克风权限被拒绝 → 回调并中断
      setMicrophonePermission('denied');
      callbacksRef.current.onPermissionDenied?.(
        permResult.micError ?? new Error('麦克风权限被拒绝')
      );
      return {
        started: false,
        retryable: false,
        reason: 'permission-denied',
      };
    }

    // 麦克风权限获取成功
    setMicrophonePermission('granted');
    callbacksRef.current.onPermissionGranted?.();

    // ===== Step 3: 确定 meetingId =====
    let meetingId: string;

    if (existingMeetingId) {
      // 场景二：已有会议
      meetingId = existingMeetingId;
    } else {
      // 场景一：调用回调创建会议
      try {
        meetingId = await onMeetingCreate!();
      } catch (error: any) {
        console.error('会议创建失败:', error);
        // 创建失败 → 释放已获取的权限资源
        globalAudioManager.releasePermissions();
        callbacksRef.current.onError?.(
          '会议创建失败: ' + (error?.message ?? String(error))
        );
        return {
          started: false,
          retryable: false,
          reason: 'meeting-create-failed',
        };
      }
    }

    if (!meetingId) {
      globalAudioManager.releasePermissions();
      callbacksRef.current.onError?.('会议ID无效');
      return {
        started: false,
        retryable: false,
        reason: 'invalid-meeting-id',
      };
    }

    setGlobalStartMeetingId(meetingId);

    // ===== Step 4: 连接 WebSocket =====
    connectWebSocket(meetingId);

    // ===== Step 5: 权限通过后立即启动录制（不等待 WebSocket）=====
    const success = globalAudioManager.startRecordingFromStreams();
    if (success) {
      clearRecentStopMark();
      recordingSession.save(meetingId);
      setGlobalRecordingLock(meetingId);
      // 录制已开始，写入跨页签状态；WebSocket 是否已连上由连接状态机自行推进
      webSocketMonitor.connect(meetingId);
      webSocketMonitor.updateActiveTime(meetingId);
      // 路由跳转过程中偶发存在连接未就绪但未及时推进的问题：
      // 这里做一次短延迟保底唤醒，不影响“权限后立即开始录制”的主流程。
      setTimeout(() => {
        const sameMeeting = globalWebSocketManager.getMeetingId() === meetingId;
        if (
          sameMeeting &&
          globalAudioManager.isRecordingActive() &&
          !globalWebSocketManager.isConnected()
        ) {
          connectWebSocket(meetingId);
        }
      }, 1500);
      callbacksRef.current.onRecordingStart?.();
      return {
        started: true,
        retryable: false,
        reason: 'started',
      };
    }

    callbacksRef.current.onError?.('启动录制失败');
    return {
      started: false,
      retryable: true,
      reason: 'start-recording-failed',
    };
  } catch (error: any) {
    console.error('开始录音失败:', error);

    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      setMicrophonePermission('denied');
      callbacksRef.current.onPermissionDenied?.(error);
    } else {
      callbacksRef.current.onError?.(
        '开始录音失败: ' + (error?.message ?? String(error))
      );
    }
    return {
      started: false,
      retryable: true,
      reason:
        error?.name === 'NotAllowedError' ||
        error?.name === 'PermissionDeniedError'
          ? 'permission-denied'
          : 'unexpected-error',
    };
  } finally {
    resetGlobalStartState();
    isStartingRef.current = false;
    releaseStartRecordingMutex(mutexOwnerId);
  }
}
