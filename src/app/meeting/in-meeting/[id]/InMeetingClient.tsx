'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import Header from './components/Header';
import Recording from './components/Recording';
import Goal from './components/Goal';
import Note from './components/Note';
import Footer from './components/Footer';
import { rebuildRecording } from './utils';
import {
  getGlobalWebSocketManager,
  hasActiveAudioRecording,
  useAudioWebSocket,
} from '@/hooks/useAudioWebSocket/index';
import { webSocketMonitor } from '@/lib/websocket/webSocketMonitor';
import { useToast } from '@/components/hooks/use-toast';
import { recordingSession } from '@/lib/audio/recordingSession';
import useObserver from '@/components/hooks/useObserver';

interface InMeetingClientProps {
  id: string;
  type: string;
  meetingData: any;
  meetingDetail: any;
}

const InMeetingClient: React.FC<InMeetingClientProps> = ({
  id,
  type,
  meetingData,
  meetingDetail,
}) => {
  const {
    transcripts = [],
    goals = [],
    note = '',
    status = 0,
  } = meetingDetail || {};
  const sourceType = meetingData?.sourceType;
  const { toast } = useToast();
  const hasCheckedRef = useRef(false);
  const kickoffRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kickoffRetryAttemptsRef = useRef(0);
  const navigationTypeRef = useRef<string>(
    typeof window !== 'undefined'
      ? (
          performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined
        )?.type ?? 'unknown'
      : 'unknown'
  );
  const { observer } = useObserver();

  const {
    isRecording,
    connectionState,
    microphonePermission,
    startRecording,
    endSession,
    manualReconnect,
  } = useAudioWebSocket({
    sampleRate: 16000,
    chunkDurationMs: 200,
    resumeMeetingId: id,
    onRecordingStart: () => {
      console.log('Recording started');
    },
    onRecordingStop: () => {
      console.log('Recording stopped');
    },
    onPermissionDenied: (error) => {
      console.log('权限被拒绝，错误信息:', error);

      if (error?.name === 'NotAllowedError') {
        toast({
          description:
            'The microphone permission has been denied. Enable permission to continue recording.',
          variant: 'warning',
        });

        toast({
          description: (
            <div className="flex flex-col items-center">
              <div className="font-medium ml-2 mr-2">
                The microphone permission has been denied. Enable permission to
                continue recording.See documentation:
              </div>
              <a
                href="/mic-perms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1456f0] hover:bg-[#f0f4ff]/80"
              >
                How to enable microphone access in the browser
              </a>
            </div>
          ),
          variant: 'warning',
          duration: 10000,
        });
      } else {
        toast({
          description: error?.message,
          variant: 'warning',
        });
      }
    },
  });

  useEffect(() => {
    observer?.on('END_AUDIO_SOCKET', endSession);
    return () => {
      observer?.off('END_AUDIO_SOCKET', endSession);
    };
  }, [endSession, observer]);

  useEffect(() => {
    let cancelled = false;
    const kickoffGuardWindowMs = 5000;
    const kickoffRetryDelayMs = 500;
    // 重试窗口必须覆盖 kickoff guard window（并留一点调度余量），
    // 否则会在 guard 结束前就停止重试，导致永远不触发真正启动。
    const maxKickoffRetries = Math.ceil(
      (kickoffGuardWindowMs + kickoffRetryDelayMs * 2) / kickoffRetryDelayMs
    );
    const clearKickoffMarker = () => {
      if (typeof window === 'undefined') return;
      localStorage.removeItem('ONGOING_RECORD_MEETING_ID');
      localStorage.removeItem('ONGOING_RECORD_MEETING_TS');
    };

    const scheduleKickoffRetry = () => {
      if (cancelled || hasCheckedRef.current) return;
      if (kickoffRetryAttemptsRef.current >= maxKickoffRetries) {
        console.info('[kickoff-retry] reached max retries', {
          meetingId: id,
          attempts: kickoffRetryAttemptsRef.current,
        });
        clearKickoffMarker();
        hasCheckedRef.current = true;
        return;
      }
      kickoffRetryAttemptsRef.current += 1;
      console.info('[kickoff-retry] schedule retry', {
        meetingId: id,
        attempt: kickoffRetryAttemptsRef.current,
        maxRetries: maxKickoffRetries,
      });
      if (kickoffRetryTimerRef.current) {
        clearTimeout(kickoffRetryTimerRef.current);
      }
      kickoffRetryTimerRef.current = setTimeout(() => {
        kickoffRetryTimerRef.current = null;
        void tryStartRecording();
      }, kickoffRetryDelayMs);
    };

    const tryStartRecording = async () => {
      if (cancelled || hasCheckedRef.current) return;
      const wsManager = getGlobalWebSocketManager();
      const wsState = wsManager.getConnectionState();
      const wsMeetingId = wsManager.getMeetingId();
      const isWsHealthyForCurrentMeeting =
        wsMeetingId === id &&
        (wsState === 'connected' || wsState === 'reconnecting');

      // 会前创建会议后跳会中的“直通恢复”：
      // 若命中一次性 meeting 标记，优先立即触发 startRecording，
      // 避免被跨页签残留状态拦截导致延迟或不发送。
      let kickoffMeetingId =
        typeof window !== 'undefined'
          ? localStorage.getItem('ONGOING_RECORD_MEETING_ID')
          : null;

      // 刷新会中：不走会前“直通恢复”标记，恢复原有自动拉起流程（可能触发权限）
      if (
        kickoffMeetingId &&
        kickoffMeetingId === id &&
        navigationTypeRef.current === 'reload'
      ) {
        clearKickoffMarker();
        kickoffMeetingId = null;
      }

      if (kickoffMeetingId && kickoffMeetingId === id) {
        console.info('[kickoff-retry] kickoff marker hit', {
          meetingId: id,
          attempt: kickoffRetryAttemptsRef.current,
        });
        // WS 已处于健康连接，说明链路可用，不再做额外补连重试。
        if (isWsHealthyForCurrentMeeting) {
          console.info('[kickoff-retry] ws already healthy, finish kickoff', {
            meetingId: id,
          });
          kickoffRetryAttemptsRef.current = 0;
          clearKickoffMarker();
          hasCheckedRef.current = true;
          return;
        }

        const autoStartOptions = {
          meetingId: id,
          silentOtherTabToast: true,
        } as const;
        const kickoffTsRaw =
          typeof window !== 'undefined'
            ? localStorage.getItem('ONGOING_RECORD_MEETING_TS')
            : null;
        const kickoffTs = kickoffTsRaw ? Number(kickoffTsRaw) : NaN;
        const kickoffElapsedMs = Number.isFinite(kickoffTs)
          ? Date.now() - kickoffTs
          : Number.POSITIVE_INFINITY;
        const forceAlignAfterGuardWindow =
          kickoffElapsedMs >= kickoffGuardWindowMs;
        const hasActiveLocalSignals =
          hasActiveAudioRecording() || recordingSession.hasPendingSession(id);
        const shouldTryAlign =
          hasActiveLocalSignals || forceAlignAfterGuardWindow;
        console.info('[kickoff-retry] align condition', {
          meetingId: id,
          attempt: kickoffRetryAttemptsRef.current,
          hasActiveLocalSignals,
          forceAlignAfterGuardWindow,
          kickoffElapsedMs,
        });

        // 仅在“已有会话迹象”时做一次对齐补连，避免会中页触发新的权限弹窗。
        // 若超过保护窗口仍无会话迹象，也强制做一次对齐，避免稳定卡死在“永远不发消息”状态。
        if (shouldTryAlign) {
          const result = await startRecording(autoStartOptions);
          console.info('[kickoff-retry] startRecording result', {
            meetingId: id,
            attempt: kickoffRetryAttemptsRef.current,
            reason: result.reason,
            started: result.started,
            retryable: result.retryable,
          });
          if (result.started) {
            kickoffRetryAttemptsRef.current = 0;
            clearKickoffMarker();
            hasCheckedRef.current = true;
            return;
          }
          if (result.retryable) {
            scheduleKickoffRetry();
            return;
          }
          clearKickoffMarker();
          hasCheckedRef.current = true;
          return;
        }
        console.info('[kickoff-retry] wait for local signals', {
          meetingId: id,
          attempt: kickoffRetryAttemptsRef.current,
        });
        scheduleKickoffRetry();
        return;
      }

      // 网络与 WS 均正常时，不触发多余重连/重试。
      if (isWsHealthyForCurrentMeeting) {
        hasCheckedRef.current = true;
        return;
      }

      if (
        isRecording &&
        wsMeetingId === id &&
        (wsState === 'disconnected' || wsState === 'failed')
      ) {
        // 录制仍在进行但 WS 断开：触发一次补连，不再等待刷新恢复
        const result = await startRecording({
          meetingId: id,
          silentOtherTabToast: true,
        });
        if (result.started) {
          hasCheckedRef.current = true;
          return;
        }
        if (result.retryable) {
          hasCheckedRef.current = true;
          return;
        }
        return;
      }

      if (isRecording) {
        // 录制状态存在但会中页刚挂载时，meetingId/连接状态可能仍在切换。
        // 这里统一再走一次 startRecording 对齐状态，避免“看起来在录制但 WS 不发消息”。
        const result = await startRecording({
          meetingId: id,
          silentOtherTabToast: true,
        });
        if (result.started) {
          hasCheckedRef.current = true;
          return;
        }
        if (result.retryable) {
          hasCheckedRef.current = true;
          return;
        }
        hasCheckedRef.current = true;
        return;
      }

      if (sourceType !== 4) {
        hasCheckedRef.current = true;
        return;
      }

      // 会前页已启动（含“启动中”）或其他页面已有活跃录制时，不再重复拉起权限流程。
      // 这里仅做轻量清理，不做前置拦截；
      // 是否应拦截由 startRecording 内部统一判定（含更完整的跨标签清理/互斥逻辑），
      // 避免线上因 monitor 脏状态被动重试 10+ 次才真正发起连接。
      webSocketMonitor.cleanupExpiredConnections();
      webSocketMonitor.forceCleanupLikelyStaleConnections(12000);

      const hasPending = recordingSession.hasPendingSession(id);
      if (hasPending) {
        recordingSession.clear();
      }
      const result = await startRecording({
        meetingId: id,
        silentOtherTabToast: true,
      });
      if (result.started) {
        hasCheckedRef.current = true;
        return;
      }
      if (result.retryable) {
        hasCheckedRef.current = true;
        return;
      }
      // 非可重试失败（如权限拒绝）结束自动尝试，避免循环打扰用户
      hasCheckedRef.current = true;
    };

    void tryStartRecording();

    return () => {
      cancelled = true;
      if (kickoffRetryTimerRef.current) {
        clearTimeout(kickoffRetryTimerRef.current);
        kickoffRetryTimerRef.current = null;
      }
    };
  }, [id, isRecording, sourceType, startRecording]);

  const headerNode = useMemo(
    () => <Header meeting={meetingData} status={status} type={type} />,
    [meetingData, status, type]
  );

  const recordingNode = useMemo(
    () => (
      <Recording
        id={id}
        transcripts={rebuildRecording(transcripts)}
        status={status}
        sourceType={sourceType}
      />
    ),
    [id, transcripts, status, sourceType]
  );

  const goalNode = useMemo(
    () => (goals.length ? <Goal id={id} list={goals} /> : null),
    [goals, id]
  );

  const noteNode = useMemo(() => <Note id={id} content={note} />, [id, note]);

  return (
    <div className="pl-6 pr-6 h-full bg-[#FAFAFA] flex flex-col">
      <div className="flex-shrink-0">{headerNode}</div>
      <div className="flex gap-4 flex-[1] overflow-hidden">
        <div className="flex flex-col gap-4 flex-[7] overflow-hidden rounded-[16px]">
          {recordingNode}
        </div>
        <div className="flex flex-col gap-4 flex-[5]">
          {/* Keep first child node stable to avoid remounting Note when goals toggles */}
          <div className={goals.length ? '' : 'hidden'}>{goalNode}</div>
          <div className="flex-1 overflow-hidden rounded-[16px]">
            {noteNode}
          </div>
        </div>
      </div>
      <Footer
        id={id}
        status={status}
        type={type}
        sourceType={sourceType}
        hasActiveRecording={
          isRecording ||
          connectionState === 'connected' ||
          connectionState === 'reconnecting'
        }
        onDisconnect={endSession}
        connectionState={connectionState}
        retryConnect={manualReconnect}
        microphonePermission={microphonePermission}
      />
    </div>
  );
};

export default InMeetingClient;