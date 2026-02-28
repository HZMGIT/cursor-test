// ==================== 类型定义 ====================
export interface PermissionResult {
  /** 麦克风权限是否获取成功 */
  micGranted: boolean;
  /** 屏幕共享权限是否获取成功 */
  screenShareGranted: boolean;
  /** 屏幕共享是否包含音频轨道 */
  hasScreenShareAudio: boolean;
  /** 麦克风权限获取失败时的错误信息 */
  micError?: Error;
}

// ==================== 全局音频管理器 ====================
class GlobalAudioManager {
  private static instance: GlobalAudioManager;
  private isRecording = false;
  private recordingStartTime = 0;
  private recordingTimer: NodeJS.Timeout | null = null;

  // 音频资源
  private microphoneStream: MediaStream | null = null;
  private screenShareStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private screenShareSource: MediaStreamAudioSourceNode | null = null;
  private microphoneProcessor: ScriptProcessorNode | null = null;
  private screenShareProcessor: ScriptProcessorNode | null = null;

  // 音频缓冲区（使用 chunk 列表避免每次拷贝整个数组导致 GC 压力）
  private microphoneChunks: Float32Array[] = [];
  private microphoneBufferLength = 0;
  private screenShareChunks: Float32Array[] = [];
  private screenShareBufferLength = 0;

  // 音频参数
  private sampleRate = 16000;
  private chunkDurationMs = 200;
  private samplesPerChunk = 0;
  private hasScreenShareAudio = false;

  // 回调函数
  private sendAudioDataCallback:
    | ((
        audioData: Float32Array,
        type: 'microphone' | 'screenShare' | 'mixed'
      ) => void)
    | null = null;

  // 状态订阅者
  private subscribers: Set<(state: any) => void> = new Set();
  private lastNotifiedState: any = null;
  // 权限请求并发去重：避免重复触发浏览器权限弹窗
  private permissionRequestPromise: Promise<PermissionResult> | null = null;

  private constructor() {
    this.calculateSamplesPerChunk();
  }

  static getInstance(): GlobalAudioManager {
    if (!GlobalAudioManager.instance) {
      GlobalAudioManager.instance = new GlobalAudioManager();
    }
    return GlobalAudioManager.instance;
  }

  private calculateSamplesPerChunk(): void {
    this.samplesPerChunk = Math.floor(
      (this.sampleRate * this.chunkDurationMs) / 1000
    );
  }

  setAudioParams(sampleRate: number, chunkDurationMs: number): void {
    this.sampleRate = sampleRate;
    this.chunkDurationMs = chunkDurationMs;
    this.calculateSamplesPerChunk();
  }

  setSendAudioDataCallback(
    callback: (
      audioData: Float32Array,
      type: 'microphone' | 'screenShare' | 'mixed'
    ) => void
  ): void {
    this.sendAudioDataCallback = callback;
  }

  subscribe(callback: (state: any) => void): () => void {
    this.subscribers.add(callback);

    // 立即发送当前状态
    setTimeout(() => {
      callback(this.getState());
    }, 0);

    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notifySubscribers(): void {
    const currentState = this.getState();

    // 检查状态是否真的改变了
    const shouldNotify =
      !this.lastNotifiedState ||
      JSON.stringify(currentState) !== JSON.stringify(this.lastNotifiedState);

    if (shouldNotify) {
      this.lastNotifiedState = currentState;

      // 异步通知所有订阅者
      setTimeout(() => {
        this.subscribers.forEach((callback) => {
          try {
            callback(currentState);
          } catch (error) {
            console.error('Error in subscriber callback:', error);
          }
        });
      }, 0);
    }
  }

  private getState() {
    return {
      isRecording: this.isRecording,
      recordingTime: this.isRecording
        ? Math.floor((Date.now() - this.recordingStartTime) / 1000)
        : 0,
    };
  }

  // ==================== 权限请求（第一步） ====================

  /**
   * 仅请求麦克风和屏幕共享权限，获取媒体流并暂存。
   * 不启动录制，不创建音频处理器。
   *
   * 调用方根据返回结果决定后续操作：
   * - micGranted=true  → 可继续创建会议 / 连接 WebSocket / 调用 startRecordingFromStreams()
   * - micGranted=false → 应中断流程并提示用户
   */
  async requestPermissions(): Promise<PermissionResult> {
    // 如果正在录音，不要重复请求
    if (this.isRecording) {
      return {
        micGranted: true,
        screenShareGranted: !!this.screenShareStream,
        hasScreenShareAudio: this.hasScreenShareAudio,
      };
    }

    // 并发调用复用同一个权限请求，避免 Firefox 下界面闪烁/重复弹窗
    if (this.permissionRequestPromise) {
      return this.permissionRequestPromise;
    }

    this.permissionRequestPromise = (async () => {
      // 清理之前可能残留的流（例如上次请求后未录制就取消了）
      this.cleanupAudioResources();

      let micGranted = false;
      let screenShareGranted = false;
      let micError: Error | undefined;

      // 1. 获取麦克风权限
      try {
        // 注意：不在 getUserMedia 中指定 sampleRate，原因：
        // 1. Firefox 部分版本不支持 sampleRate 约束，会导致 OverconstrainedError 且不弹出权限对话框
        // 2. AudioContext 已用目标 sampleRate 创建，会自动对硬件采样率进行重采样
        this.microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
        });
        micGranted = true;
        console.log('Microphone permission granted');
      } catch (error) {
        console.error('Microphone permission denied:', error);
        micError = error instanceof Error ? error : new Error(String(error));
      }

      // 麦克风权限被拒绝 → 直接返回，不请求屏幕共享
      if (!micGranted) {
        return {
          micGranted,
          screenShareGranted,
          hasScreenShareAudio: false,
          micError,
        };
      }

      // 2. 尝试获取屏幕共享权限（可选，拒绝不影响后续流程）
      try {
        this.screenShareStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        this.hasScreenShareAudio =
          this.screenShareStream.getAudioTracks().length > 0;
        screenShareGranted = true;
        console.log(
          'Screen share permission granted, has audio:',
          this.hasScreenShareAudio
        );
      } catch (error) {
        console.warn('Screen share permission denied:', error);
        this.hasScreenShareAudio = false;
      }

      return {
        micGranted,
        screenShareGranted,
        hasScreenShareAudio: this.hasScreenShareAudio,
        micError,
      };
    })();

    try {
      return await this.permissionRequestPromise;
    } finally {
      this.permissionRequestPromise = null;
    }
  }

  // ==================== 启动录制（第二步） ====================

  /**
   * 基于已获取的媒体流创建音频处理器并启动录制。
   * 必须先调用 requestPermissions() 且 micGranted=true。
   *
   * @returns true 录制启动成功；false 失败（无麦克风流或处理器创建失败）
   */
  startRecordingFromStreams(): boolean {
    if (this.isRecording) {
      console.warn('Recording is already in progress');
      return false;
    }

    if (!this.microphoneStream) {
      console.error(
        'No microphone stream available. Call requestPermissions() first.'
      );
      return false;
    }

    try {
      // 创建音频处理器
      if (!this.createAudioProcessors()) {
        this.cleanupAudioResources();
        return false;
      }

      // 开始录制
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      // 启动录制计时器
      this.recordingTimer = setInterval(() => {
        this.notifySubscribers();
      }, 1000);

      this.notifySubscribers();
      console.log('Global recording started successfully');
      return true;
    } catch (error) {
      console.error('Failed to start recording from streams:', error);
      this.cleanupAudioResources();
      return false;
    }
  }

  // ==================== 释放权限（异常分支清理） ====================

  /**
   * 释放已获取但未使用的媒体流。
   * 用于以下场景：权限获取成功后，后续步骤（如创建会议）失败，需要回收资源。
   * 如果正在录制则不执行任何操作。
   */
  releasePermissions(): void {
    if (this.isRecording) {
      console.warn(
        'Cannot release permissions while recording. Call stopRecording() first.'
      );
      return;
    }
    this.cleanupAudioResources();
    console.log('Permissions released');
  }

  // ==================== 音频处理器 ====================

  private createAudioProcessors(): boolean {
    try {
      if (!this.audioContext) {
        this.audioContext = new (
          window.AudioContext || (window as any).webkitAudioContext
        )({
          sampleRate: this.sampleRate,
        });
      }

      // 麦克风音频处理器
      if (this.microphoneStream) {
        this.microphoneSource = this.audioContext.createMediaStreamSource(
          this.microphoneStream
        );
        this.microphoneProcessor = this.audioContext.createScriptProcessor(
          2048,
          1,
          1
        );

        this.microphoneProcessor.onaudioprocess = (event) => {
          this.processMicrophoneAudio(event);
        };

        this.microphoneSource.connect(this.microphoneProcessor);
        this.microphoneProcessor.connect(this.audioContext.destination);
      }

      // 屏幕共享音频处理器
      if (this.screenShareStream && this.hasScreenShareAudio) {
        this.screenShareSource = this.audioContext.createMediaStreamSource(
          this.screenShareStream
        );
        this.screenShareProcessor = this.audioContext.createScriptProcessor(
          2048,
          1,
          1
        );

        this.screenShareProcessor.onaudioprocess = (event) => {
          this.processScreenShareAudio(event);
        };

        this.screenShareSource.connect(this.screenShareProcessor);
        this.screenShareProcessor.connect(this.audioContext.destination);
      }

      return true;
    } catch (error) {
      console.error('Failed to create audio processors:', error);
      return false;
    }
  }

  // ==================== 音频数据处理 ====================

  /**
   * 从 chunk 列表中提取指定长度的连续数据，并移除已消费的 chunk
   */
  private drainChunks(
    chunks: Float32Array[],
    lengthRef: { value: number },
    count: number
  ): Float32Array {
    const result = new Float32Array(count);
    let offset = 0;
    let remaining = count;

    while (remaining > 0 && chunks.length > 0) {
      const chunk = chunks[0];
      if (chunk.length <= remaining) {
        // 整块消费
        result.set(chunk, offset);
        offset += chunk.length;
        remaining -= chunk.length;
        chunks.shift();
      } else {
        // 部分消费
        result.set(chunk.subarray(0, remaining), offset);
        chunks[0] = chunk.subarray(remaining);
        offset += remaining;
        remaining = 0;
      }
    }

    lengthRef.value -= count;
    return result;
  }

  private processMicrophoneAudio(event: AudioProcessingEvent): void {
    if (!this.isRecording || !this.sendAudioDataCallback) return;

    const inputData = event.inputBuffer.getChannelData(0);
    // 存储引用拷贝而非全量拷贝（getChannelData 返回的缓冲区会被复用）
    const copy = new Float32Array(inputData.length);
    copy.set(inputData);
    this.microphoneChunks.push(copy);
    this.microphoneBufferLength += copy.length;

    this.processAndSendAudio();
  }

  private processScreenShareAudio(event: AudioProcessingEvent): void {
    if (
      !this.isRecording ||
      !this.sendAudioDataCallback ||
      !this.hasScreenShareAudio
    )
      return;

    const inputData = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(inputData.length);
    copy.set(inputData);
    this.screenShareChunks.push(copy);
    this.screenShareBufferLength += copy.length;

    this.processAndSendAudio();
  }

  private processAndSendAudio(): void {
    if (!this.isRecording || !this.sendAudioDataCallback) return;

    if (this.microphoneBufferLength >= this.samplesPerChunk) {
      const micLenRef = { value: this.microphoneBufferLength };
      const micChunk = this.drainChunks(
        this.microphoneChunks,
        micLenRef,
        this.samplesPerChunk
      );
      this.microphoneBufferLength = micLenRef.value;

      // 发送麦克风流
      this.sendAudioDataCallback(micChunk, 'microphone');

      if (this.hasScreenShareAudio) {
        if (this.screenShareBufferLength >= this.samplesPerChunk) {
          const screenLenRef = { value: this.screenShareBufferLength };
          const screenChunk = this.drainChunks(
            this.screenShareChunks,
            screenLenRef,
            this.samplesPerChunk
          );
          this.screenShareBufferLength = screenLenRef.value;

          // 发送屏幕共享流
          this.sendAudioDataCallback(screenChunk, 'screenShare');

          // 创建并发送混合音频
          const mixedChunk = new Float32Array(this.samplesPerChunk);
          for (let i = 0; i < this.samplesPerChunk; i++) {
            mixedChunk[i] = (micChunk[i] + screenChunk[i]) / 2;
            mixedChunk[i] = Math.max(-1, Math.min(1, mixedChunk[i]));
          }
          this.sendAudioDataCallback(mixedChunk, 'mixed');
        } else {
          this.sendAudioDataCallback(micChunk, 'mixed');
        }
      } else {
        this.sendAudioDataCallback(micChunk, 'mixed');
      }
    }
  }

  // ==================== 停止录制 ====================

  stopRecording(): void {
    // 即使当前 isRecording=false，也要释放可能残留的麦克风/屏幕流。
    // 场景：权限已获取但录制流程未完全启动，此时 endSession 也需要关闭麦克风占用。
    if (!this.isRecording) {
      this.cleanupAudioResources();
      return;
    }

    console.log('Stopping global recording...');
    this.isRecording = false;

    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    this.cleanupAudioResources();
    this.notifySubscribers();

    console.log('Global recording stopped');
  }

  // ==================== 资源清理 ====================

  private cleanupAudioResources(): void {
    [this.microphoneProcessor, this.screenShareProcessor].forEach(
      (processor) => {
        if (processor) {
          processor.disconnect();
          processor.onaudioprocess = null;
        }
      }
    );

    [this.microphoneSource, this.screenShareSource].forEach((source) => {
      if (source) {
        source.disconnect();
      }
    });

    [this.microphoneStream, this.screenShareStream].forEach((stream) => {
      if (stream) {
        stream.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false;
        });
      }
    });

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(console.error);
    }

    this.audioContext = null;
    this.microphoneSource = null;
    this.screenShareSource = null;
    this.microphoneProcessor = null;
    this.screenShareProcessor = null;
    this.microphoneStream = null;
    this.screenShareStream = null;
    this.hasScreenShareAudio = false;
    this.microphoneChunks = [];
    this.microphoneBufferLength = 0;
    this.screenShareChunks = [];
    this.screenShareBufferLength = 0;
  }

  // ==================== 状态查询 ====================

  isRecordingActive(): boolean {
    return this.isRecording;
  }

}

export const globalAudioManager = GlobalAudioManager.getInstance();
