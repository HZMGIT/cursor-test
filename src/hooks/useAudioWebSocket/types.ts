import type { ConnectionState } from '@/lib/websocket/GlobalWebSocketManager';

export interface AudioWebSocketConfig {
  sampleRate?: number;
  chunkDurationMs?: number;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  onStatusChange?: (status: string) => void;
  onError?: (error: string) => void;
  onMessage?: (message: string) => void;
  /** 麦克风权限被拒绝回调（参数携带错误信息） */
  onPermissionDenied?: (error: Error) => void;
  /** 麦克风权限获取成功回调 */
  onPermissionGranted?: () => void;
  /**
   * 当前页面对应的会议ID（仅会中页面传入）
   *
   * - 传入：刷新后若 sessionStorage 中存在该会议的待恢复会话 -> 保留会话，
   *         由组件根据业务逻辑（会议类型等）自行调用 startRecording 恢复
   * - 不传：刷新后自动清除待恢复会话（即终止录制流程）
   *
   * 效果：除会中页面外，所有页面刷新都会自动终止录制流程
   */
  resumeMeetingId?: string;
}

/**
 * startRecording 方法的参数
 *
 * 场景一（新建会议）：传 onMeetingCreate，权限获取成功后调用该方法创建会议并返回 meetingId
 * 场景二（已有会议）：直接传 meetingId
 */
export interface StartRecordingOptions {
  /** 已有的会议ID（场景二） */
  meetingId?: string;
  /**
   * 静默模式：
   * 命中“其他标签页正在录音”时，不弹提示，仅返回 reason 供调用方处理。
   * 主要用于页面自动恢复/自动对齐流程，避免打扰当前页用户。
   */
  silentOtherTabToast?: boolean;
  /**
   * 权限获取成功后创建会议的异步回调（场景一）
   * 需返回创建成功的 meetingId
   */
  onMeetingCreate?: () => Promise<string>;
}

export interface StartRecordingResult {
  started: boolean;
  retryable: boolean;
  reason:
    | 'started'
    | 'invalid-options'
    | 'already-recording'
    | 'already-starting'
    | 'mutex-not-acquired'
    | 'active-connection-exists'
    | 'permission-denied'
    | 'meeting-create-failed'
    | 'invalid-meeting-id'
    | 'start-recording-failed'
    | 'unexpected-error';
}

interface AudioWebSocketState {
  isRecording: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  recordingTime: number;
  currentMeetingId?: string;
  microphonePermission: 'granted' | 'denied' | 'prompt' | 'unknown';
  connectionState: ConnectionState;
}

interface AudioWebSocketControls {
  startRecording: (options: StartRecordingOptions) => Promise<StartRecordingResult>;
  /** 仅停止音频采集，不断开 WebSocket（适用于暂停场景） */
  stopRecording: () => void;
  /** 停止录制 + 强制断开 WebSocket + 清理所有资源（结束会议时调用） */
  endSession: () => void;
  connectWebSocket: (meetingId: string) => void;
  disconnectWebSocket: () => void;
  sendAudioData: (
    audioData: Float32Array,
    type: 'microphone' | 'screenShare' | 'mixed'
  ) => void;
  checkMicrophonePermission: () => Promise<boolean>;
  manualReconnect: () => void;
  /** 退出登录场景：有录制会话则停止并清理，返回是否存在会话 */
  stopRecordingForLogout: () => { hadActiveSession: boolean };
}

export interface UseAudioWebSocketReturn
  extends AudioWebSocketState,
    AudioWebSocketControls {
  formattedTime: string;
  sampleRate: number;
  chunkDurationMs: number;
  samplesPerChunk: number;
}

export interface AudioWebSocketCallbacks {
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  onStatusChange?: (status: string) => void;
  onError?: (error: string) => void;
  onMessage?: (message: string) => void;
  onPermissionDenied?: (error: Error) => void;
  onPermissionGranted?: () => void;
}
