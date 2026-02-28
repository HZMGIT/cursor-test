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
import { useToast } from '@/components/hooks/use-toast';
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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    let attempts = 0;
    const maxAttempts = 45;
    const retryDelayMs = 1000;

    const scheduleRetry = () => {
      attempts += 1;
      if (attempts <= maxAttempts) {
        retryTimerRef.current = setTimeout(() => {
          void tryStartRecording();
        }, retryDelayMs);
      }
    };

    const tryStartRecording = async () => {
      if (cancelled || hasCheckedRef.current) return;

      // 会前创建会议后跳会中的“直通恢复”：
      // 若命中一次性 meeting 标记，优先立即触发 startRecording，
      // 避免被跨页签残留状态拦截导致延迟或不发送。
      const kickoffMeetingId =
        typeof window !== 'undefined'
          ? localStorage.getItem('ONGOING_RECORD_MEETING_ID')
          : null;
      if (kickoffMeetingId && kickoffMeetingId === id) {
        const wsManager = getGlobalWebSocketManager();
        const wsState = wsManager.getConnectionState();
        const wsMeetingId = wsManager.getMeetingId();
        const hasActiveLocalSignals =
          hasActiveAudioRecording() ||
          (wsMeetingId === id &&
            (wsState === 'connected' || wsState === 'reconnecting'));

        // 仅在“已有会话迹象”时做一次对齐补连，避免会中页触发新的权限弹窗。
        if (hasActiveLocalSignals) {
          localStorage.removeItem('ONGOING_RECORD_MEETING_ID');
          const result = await startRecording({ meetingId: id });
          if (result.started) {
            hasCheckedRef.current = true;
            return;
          }
          if (result.retryable) {
            scheduleRetry();
            return;
          }
          return;
        }

        // 会前页可能仍在完成最后收敛，这里先等待重试，不主动触发权限流程。
        scheduleRetry();
        return;
      }

      const wsManager = getGlobalWebSocketManager();
      const wsState = wsManager.getConnectionState();
      const wsMeetingId = wsManager.getMeetingId();

      if (
        isRecording &&
        wsMeetingId === id &&
        (wsState === 'disconnected' || wsState === 'failed')
      ) {
        // 录制仍在进行但 WS 断开：触发一次补连，不再等待刷新恢复
        const result = await startRecording({ meetingId: id });
        if (result.started) {
          hasCheckedRef.current = true;
          return;
        }
        if (result.retryable) {
          scheduleRetry();
          return;
        }
        return;
      }

      if (isRecording) {
        // 录制状态存在但会中页刚挂载时，meetingId/连接状态可能仍在切换。
        // 这里统一再走一次 startRecording 对齐状态，避免“看起来在录制但 WS 不发消息”。
        const result = await startRecording({ meetingId: id });
        if (result.started) {
          hasCheckedRef.current = true;
          return;
        }
        if (result.retryable) {
          scheduleRetry();
          return;
        }
        hasCheckedRef.current = true;
        return;
      }

      if (sourceType !== 4) {
        hasCheckedRef.current = true;
        return;
      }

      // 不再在会中页做“无上下文自动启动”（该路径会触发新的权限弹窗）。
      // sourceType=4 且未命中会前直通恢复时，交由用户手动 Try Again。
      hasCheckedRef.current = true;
    };

    void tryStartRecording();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
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