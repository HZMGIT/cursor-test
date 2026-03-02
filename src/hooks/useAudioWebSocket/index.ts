import { useState, useEffect, useCallback, useRef } from 'react';
import Cookies from 'js-cookie';
import {
  AUTH_TOKEN_KEY,
  getSearchParams,
  SALESSAVVY_FINGERPRINT,
} from '@/lib/utils';
import { webSocketMonitor } from '@/lib/websocket/webSocketMonitor';
import { globalAudioManager } from '@/lib/audio/GlobalAudioManager';
import { recordingSession } from '@/lib/audio/recordingSession';
import {
  globalWebSocketManager,
  type ConnectionState,
} from '@/lib/websocket/GlobalWebSocketManager';
import { createAudioPacket } from '@/lib/audio/audioPacket';
import { toast } from '@/components/hooks/use-toast';
import {
  bindAudioManagerSubscription,
  bindWebSocketSubscriptions,
} from './subscriptions';
import {
  cleanupPermissionStatusListener,
  createMicrophonePermissionChecker,
} from './permission';
import {
  hardResetCrossTabRecordingState,
  installGlobalBeforeUnloadGuard,
  setGlobalRecordingLock,
  setRecentStopMark,
} from './crossTabState';
import {
  hasOngoingRecordingSession,
  hasOngoingRecordingSessionInThisTab,
  stopRecordingIfActive,
} from './sessionGuards';
import { executeStartRecording } from './recordingFlow';
import type {
  AudioWebSocketCallbacks,
  AudioWebSocketConfig,
  StartRecordingOptions,
  StartRecordingResult,
  UseAudioWebSocketReturn,
} from './types';

/**
 * Recording workflow invariants (do not break):
 *
 * 1) Start path must be unified:
 *    - Both before-meeting and in-meeting recovery should go through startRecording().
 *    - Avoid parallel custom start flows in UI components.
 *
 * 2) Stop path must be unified:
 *    - Manual stop / SSE auto-end / logout must reuse stopRecordingIfActive() or endSession().
 *    - Do not implement isolated cleanup chains in page components.
 *
 * 3) Cross-tab state is managed here only:
 *    - global lock / start mutex / websocket monitor cleanup should stay centralized in this hook.
 *    - UI components should trigger unified APIs instead of touching storage states directly.
 *
 * 4) Correct behavior must stay unchanged:
 *    - No duplicate permission prompts after successful pre-meeting start.
 *    - No false "other tab is recording" when session has ended.
 *    - Recording starts right after permissions; websocket reconnect proceeds asynchronously.
 */

export type { StartRecordingOptions, StartRecordingResult };
export { hasOngoingRecordingSession, stopRecordingIfActive };

// ==================== React Hook ====================

export function useAudioWebSocket(
  config: AudioWebSocketConfig = {}
): UseAudioWebSocketReturn {
  const {
    sampleRate = 16000,
    chunkDurationMs = 200,
    onRecordingStart,
    onRecordingStop,
    onStatusChange,
    onError,
    onMessage,
    onPermissionDenied,
    onPermissionGranted,
    resumeMeetingId,
  } = config;

  // 使用ref存储回调函数，避免无限循环
  const callbacksRef = useRef<AudioWebSocketCallbacks>({
    onRecordingStart,
    onRecordingStop,
    onStatusChange,
    onError,
    onMessage,
    onPermissionDenied,
    onPermissionGranted,
  });

  // 更新回调ref
  useEffect(() => {
    callbacksRef.current = {
      onRecordingStart,
      onRecordingStop,
      onStatusChange,
      onError,
      onMessage,
      onPermissionDenied,
      onPermissionGranted,
    };
  }, [
    onRecordingStart,
    onRecordingStop,
    onStatusChange,
    onError,
    onMessage,
    onPermissionDenied,
    onPermissionGranted,
  ]);

  // 连接状态 —— 单一数据源，isConnected / isConnecting 由此派生
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    () => globalWebSocketManager.getConnectionState()
  );

  // 本地状态
  const [isRecording, setIsRecording] = useState(() =>
    globalAudioManager.isRecordingActive()
  );
  const [recordingTime, setRecordingTime] = useState(0);
  // 从全局管理器恢复 meetingId（路由切换后不丢失）
  const [currentMeetingId, setCurrentMeetingId] = useState<string | undefined>(
    () => globalWebSocketManager.getMeetingId() ?? undefined
  );
  const [microphonePermission, setMicrophonePermission] = useState<
    'granted' | 'denied' | 'prompt' | 'unknown'
  >('unknown');

  const isStartingRef = useRef(false);
  const meetingIdRef = useRef<string>(
    globalWebSocketManager.getMeetingId() ?? ''
  );
  const audioSendDebugRef = useRef<{
    lastDropLogAt: number;
    lastDropReason: string;
    firstSentMeetingId: string;
  }>({
    lastDropLogAt: 0,
    lastDropReason: '',
    firstSentMeetingId: '',
  });
  const isMountedRef = useRef(true);
  const lastRecordingStateRef = useRef(isRecording);

  // 派生状态
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'reconnecting';

  // 计算参数
  const SAMPLES_PER_CHUNK = Math.floor((sampleRate * chunkDurationMs) / 1000);

  // ==================== WebSocket URL ====================

  const getWebSocketUrl = useCallback(
    (meetingId: string) => {
      const token = Cookies.get(AUTH_TOKEN_KEY);
      const deviceId = Cookies.get(SALESSAVVY_FINGERPRINT);

      const urlParams = {
        token,
        deviceId,
        meetingId,
        sample: sampleRate,
        channels: 1,
        byteOrder: 'le',
      };

      console.log('window.__SALESSAVVY_CONF__', window.__SALESSAVVY_CONF__);
      return `${window.__SALESSAVVY_CONF__?.WS_SERVER_HOST}/ws/audio/browser?${getSearchParams(urlParams)}`;
    },
    [sampleRate]
  );

  // ==================== 发送音频数据 ====================
  // 不依赖任何 React 状态，从全局管理器读取 meetingId，路由切换后回调引用不变

  const sendAudioData = useCallback(
    (
      audioData: Float32Array,
      type: 'microphone' | 'screenShare' | 'mixed'
    ) => {
      const meetingId = globalWebSocketManager.getMeetingId() ?? '';
      const wsState = globalWebSocketManager.getConnectionState();
      // 双重守卫：isConnected() 现在同时检查 _connectionState === 'connected'
      // 和 readyState === OPEN，确保网络断开后不再尝试发送
      if (!globalWebSocketManager.isConnected()) {
        const now = Date.now();
        const reason = `not-connected:${wsState}`;
        if (
          now - audioSendDebugRef.current.lastDropLogAt > 3000 ||
          audioSendDebugRef.current.lastDropReason !== reason
        ) {
          audioSendDebugRef.current.lastDropLogAt = now;
          audioSendDebugRef.current.lastDropReason = reason;
          console.info('[audio-send] drop before send', {
            meetingId,
            wsState,
            packetType: type,
          });
        }
        return;
      }

      try {
        let headerType = 0;
        switch (type) {
          case 'microphone':
            headerType = 1;
            break;
          case 'screenShare':
            headerType = 2;
            break;
          case 'mixed':
            headerType = 0;
            break;
        }

        const audioPacket = createAudioPacket(audioData, headerType);
        // send() 内部有 _connectionState + navigator.onLine + readyState 三重守卫
        const sent = globalWebSocketManager.send(audioPacket.buffer as ArrayBuffer);

        if (sent) {
          if (audioSendDebugRef.current.firstSentMeetingId !== meetingId) {
            audioSendDebugRef.current.firstSentMeetingId = meetingId;
            console.info('[audio-send] first packet sent', {
              meetingId,
              packetType: type,
            });
          }
          webSocketMonitor.updateActiveTime(
            globalWebSocketManager.getMeetingId() ?? undefined
          );
        } else {
          const now = Date.now();
          const reason = `send-return-false:${wsState}`;
          if (
            now - audioSendDebugRef.current.lastDropLogAt > 3000 ||
            audioSendDebugRef.current.lastDropReason !== reason
          ) {
            audioSendDebugRef.current.lastDropLogAt = now;
            audioSendDebugRef.current.lastDropReason = reason;
            console.warn('[audio-send] send returned false', {
              meetingId,
              wsState,
              packetType: type,
            });
          }
        }
      } catch (error) {
        console.error(`Failed to send ${type} audio data:`, error);
      }
    },
    []
  );

  // ==================== 连接 WebSocket ====================

  const connectWebSocket = useCallback(
    (meetingId: string) => {
      if (!meetingId) return;
      const previousMeetingId = meetingIdRef.current;
      const managerMeetingId = globalWebSocketManager.getMeetingId();
      const isWsConnected = globalWebSocketManager.isConnected();

      if (
        isWsConnected &&
        previousMeetingId === meetingId
      ) {
        console.log('Already connected to this meeting');
        return;
      }

      if (
        isWsConnected &&
        previousMeetingId &&
        previousMeetingId !== meetingId
      ) {
        globalWebSocketManager.disconnect();
      }

      // 兜底：当本地 ref 未及时对齐但全局管理器仍连在其他 meeting 时，
      // 强制切换连接，避免“看起来已发送但发到了旧会议连接”。
      if (
        isWsConnected &&
        managerMeetingId &&
        managerMeetingId !== meetingId
      ) {
        console.warn('Detected websocket bound to different meeting, reconnecting', {
          fromMeetingId: managerMeetingId,
          toMeetingId: meetingId,
          refMeetingId: previousMeetingId,
        });
        globalWebSocketManager.disconnect();
      }

      meetingIdRef.current = meetingId;
      setCurrentMeetingId(meetingId);
      globalWebSocketManager.setMeetingId(meetingId);

      const url = getWebSocketUrl(meetingId);

      if (!globalWebSocketManager.isConnected()) {
        globalWebSocketManager.connect(url);
      } else {
        console.info('WebSocket already connected after meeting alignment', {
          meetingId,
        });
      }
    },
    [getWebSocketUrl]
  );

  // ==================== 等待 WebSocket 连接就绪 ====================

  // ==================== 订阅连接状态 + WebSocket 事件 ====================

  useEffect(() => {
    return bindWebSocketSubscriptions({
      isMountedRef,
      callbacksRef,
      setConnectionState,
    });
  }, []);

  // ==================== 订阅音频管理器状态 ====================

  useEffect(() => {
    return bindAudioManagerSubscription({
      isMountedRef,
      lastRecordingStateRef,
      callbacksRef,
      setIsRecording,
      setRecordingTime,
      sampleRate,
      chunkDurationMs,
      sendAudioData,
    });
  }, [sampleRate, chunkDurationMs, sendAudioData]);

  // ==================== 检查麦克风权限（仅查询，不弹窗） ====================

  // 用 ref 持有 PermissionStatus，以便在 cleanup 时移除 onchange
  const permissionStatusRef = useRef<PermissionStatus | null>(null);

  const checkMicrophonePermission = useCallback(
    () =>
      createMicrophonePermissionChecker(
        permissionStatusRef,
        setMicrophonePermission
      )(),
    []
  );

  // ==================== 核心流程：开始录制 ====================
  const startRecording = useCallback(
    (options: StartRecordingOptions) =>
      executeStartRecording(options, {
        connectWebSocket,
        setCurrentMeetingId,
        meetingIdRef,
        isStartingRef,
        callbacksRef,
        notifyOtherTabRecording: () =>
          toast({
            description: '其他标签页正在录音',
            variant: 'info',
          }),
        setMicrophonePermission,
      }),
    [connectWebSocket]
  );

  // ==================== 页面刷新恢复 / 终止（自动） ====================
  //
  // 此 effect 仅在挂载时执行一次（[] 依赖），放在所有订阅 effect 之后，
  // 确保 WebSocket 事件监听和音频回调都已就绪。
  //
  // 判断逻辑：
  //   1. 如果全局单例仍在录制（路由切换，非刷新）→ 不做任何事
  //   2. 如果 sessionStorage 中没有待恢复会话 → 不做任何事
  //   3. 传了 resumeMeetingId 且匹配 → 会中页面刷新 → 自动恢复录制
  //   4. 没传 resumeMeetingId 或不匹配 → 其他页面刷新 → 清除会话（终止）
  //

  const resumeMeetingIdRef = useRef(resumeMeetingId);
  resumeMeetingIdRef.current = resumeMeetingId;

  useEffect(() => {
    // 路由切换（非刷新）：全局单例还活着，不需要恢复
    if (globalAudioManager.isRecordingActive()) return;

    const pendingSession = recordingSession.get();
    if (!pendingSession) return;

    const targetMeetingId = resumeMeetingIdRef.current;

    if (
      targetMeetingId &&
      pendingSession.meetingId === targetMeetingId
    ) {
      // 会中页面刷新 → 保留会话，不自动恢复
      // 由组件根据业务逻辑（会议类型等）自行决定是否调用 startRecording
      console.log(
        'RecordingSession: 检测到待恢复会话，等待组件处理',
        targetMeetingId
      );
    } else {
      // 其他任何页面刷新 → 终止
      console.log('RecordingSession: 非会中页面，清除待恢复会话');
      recordingSession.clear();
    }
     
  }, []);

  // ==================== 组件挂载时查询权限状态 ====================

  useEffect(() => {
    checkMicrophonePermission();
  }, [checkMicrophonePermission]);

  // ==================== 定期更新活跃时间 ====================
  // 仅依赖 isRecording（不依赖 isConnected），确保 WebSocket 短暂断开
  // 重连期间定时器仍然运行，避免 monitor 记录因超时被清理后产生幽灵记录

  useEffect(() => {
    if (!isRecording) return;

    // 立即更新一次
    webSocketMonitor.updateActiveTime(
      globalWebSocketManager.getMeetingId() ?? undefined
    );
    setGlobalRecordingLock(globalWebSocketManager.getMeetingId() ?? undefined);

    const updateInterval = setInterval(() => {
      webSocketMonitor.updateActiveTime(
        globalWebSocketManager.getMeetingId() ?? undefined
      );
      setGlobalRecordingLock(globalWebSocketManager.getMeetingId() ?? undefined);
    }, 2000);

    return () => {
      clearInterval(updateInterval);
    };
  }, [isRecording]);

  // ==================== 停止录制（仅停止音频采集，不断开 WebSocket） ====================

  const stopRecording = useCallback(() => {
    globalAudioManager.stopRecording();
    webSocketMonitor.disconnect();
    recordingSession.clear();
    hardResetCrossTabRecordingState();
    setRecentStopMark();
  }, []);

  // ==================== 结束会话（停止录制 + 强制断开 WebSocket + 清理所有资源） ====================

  const endSession = useCallback(() => {
    // 1. 停止音频采集和处理
    globalAudioManager.stopRecording();
    // 兜底释放：处理“仅拿到权限流但未进入录制态”的场景
    globalAudioManager.releasePermissions();

    // 2. 强制断开 WebSocket（不依赖引用计数）
    globalWebSocketManager.disconnect();

    // 3. 清理跨标签页连接监控
    webSocketMonitor.disconnect();

    // 4. 清除持久化的录音会话
    recordingSession.clear();
    hardResetCrossTabRecordingState();
    setRecentStopMark();
  }, []);

  // ==================== 断开 WebSocket ====================

  const disconnectWebSocket = useCallback(() => {
    globalWebSocketManager.disconnect();
  }, []);

  // ==================== 手动重连 ====================

  const manualReconnect = useCallback(() => {
    globalWebSocketManager.manualReconnect();
  }, []);

  // ==================== 退出登录：判断并停止录制 ====================
  const stopRecordingForLogout = useCallback(() => {
    return stopRecordingIfActive();
  }, []);

  // ==================== 格式化时间 ====================

  const getFormattedTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // ==================== 组件挂载 / 卸载 ====================

  useEffect(() => {
    isMountedRef.current = true;
    // 全局单次注册：跨路由持续生效，不随某个页面组件卸载而丢失
    installGlobalBeforeUnloadGuard(hasOngoingRecordingSessionInThisTab);

    return () => {
      isMountedRef.current = false;
      // 清理 PermissionStatus 监听，防止对已卸载组件的 state 更新
      cleanupPermissionStatusListener(permissionStatusRef);
    };
  }, []);

  // ==================== 返回值 ====================

  return {
    // 状态
    isRecording,
    isConnected,
    isConnecting,
    recordingTime,
    currentMeetingId,
    connectionState,
    microphonePermission,

    // 计算属性
    formattedTime: getFormattedTime(recordingTime),

    // 控制方法
    startRecording,
    stopRecording,
    endSession,
    connectWebSocket,
    disconnectWebSocket,
    sendAudioData,
    checkMicrophonePermission,
    manualReconnect,
    stopRecordingForLogout,

    // 音频参数
    sampleRate,
    chunkDurationMs,
    samplesPerChunk: SAMPLES_PER_CHUNK,
  };
}

// ==================== 导出全局检查函数 ====================

export const hasActiveAudioRecording = () =>
  globalAudioManager.isRecordingActive();
export const getGlobalWebSocketManager = () => globalWebSocketManager;
