/*
 * @Description: Recording
 * @Author: guangyu.ran@msxf.com
 * @Date: 2025-10-15 15:43:49
 */
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import SwitchBox from '@/components/SwitchBox';
import Empty from '@/components/Empty';
import { TranscriptItemType } from '@/types/in-meeting';
import { useRouter } from 'next/navigation';
import { formatSeconds } from '@/lib/time';
import {
  rebuildRecording,
  parseChatInsightData,
  mergeDialogue,
} from '../../utils';
import { sseFetch } from '@/lib/sse-fetch';
import { queryInMeetingDetail } from '@/api/in-meeting';
import { isDevClient } from '@/lib/utils';
import { wsEventBus } from '../../observer';
import useObserver from '@/components/hooks/useObserver';
import { useToast } from '@/components/hooks/use-toast';
import { forceReleaseLiveWaveformMedia } from '@/components/ui/live-waveform';
import { stopRecordingIfActive } from '@/hooks/useAudioWebSocket/index';

type RecordingProps = {
  id: string;
  transcripts: TranscriptItemType[];
  status: number;
  sourceType?: number;
};

const Recording: React.FC<RecordingProps> = (props) => {
  const { id, transcripts, status, sourceType } = props;
  const [transcriptsList, setTranscriptsList] =
    useState<TranscriptItemType[]>(transcripts);
  const [userInfo, setUserInfo] = useState<any>({});
  const router = useRouter();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageTimeRef = useRef<number>(Date.now());
  const hasReceivedSseMessageRef = useRef(false);
  const isReconnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const firstMessageGraceMs = 20000;
  const heartbeatTimeoutMs = 15000;
  const abortCtrlRef = useRef<AbortController | null>(null);
  const { observer } = useObserver();
  const { toast } = useToast();

  const getDetail = async () => {
    await queryInMeetingDetail(id);
  };

  // 兜底清理，避免路由跳转时事件链丢失导致麦克风仍占用
  const forceEndAudioSession = () => {
    // 统一走 useAudioWebSocket 的停止清理闭环（含跨标签状态硬清理），
    // 避免多套清理并发导致状态竞争。
    stopRecordingIfActive();
    try {
      // Note/录制视图中的波形流不在主清理闭环内，这里做额外兜底释放。
      forceReleaseLiveWaveformMedia();
    } catch (error) {
      console.error('forceEndAudioSession: release waveform media failed', error);
    }
  };

  const handleMessage = (type: number, data: TranscriptItemType[]) => {
    switch (type) {
      case 1:
        changeTranscripts(data);
        break;
      case 2:
        if (sourceType === 4) {
          toast({
            title: 'The meeting has ended.',
            variant: 'warning',
          });
        }
        // 会议结束时统一清理音频/WS资源（不依赖 sourceType）
        observer?.trigger('END_AUDIO_SOCKET');
        forceEndAudioSession();
        router.replace(`/meeting/after-meeting/${id}?from=1`);
        break;
      case 3:
        break;
      case 4:
        break;
      case 5:
        break;
    }
    wsEventBus.trigger('disconnected', type);
  };

  const changeTranscripts = (dataArray: TranscriptItemType[]) => {
    const dataList = dataArray.filter((item) => item.transcript);
    if (!dataList?.length) return;

    setTranscriptsList((prevList) => {
      const newList = [...prevList];
      dataList.forEach((currentData) => {
        const existingIndex = newList.findIndex(
          (item) =>
            item.userId === currentData.userId &&
            item.turnOrder === currentData.turnOrder
        );

        if (existingIndex !== -1) {
          newList[existingIndex] = currentData;
        } else {
          newList.push(currentData);
        }
      });
      return rebuildRecording(newList);
    });

    wsEventBus.trigger('speaking', dataList);
  };

  const filteredList = useMemo(() => {
    return mergeDialogue(transcriptsList);
  }, [transcriptsList]);

  const startHeartbeatCheck = () => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
    }

    heartbeatTimerRef.current = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = now - lastMessageTimeRef.current;
      const timeoutMs = hasReceivedSseMessageRef.current
        ? heartbeatTimeoutMs
        : firstMessageGraceMs;
      if (timeSinceLastMessage > timeoutMs) {
        console.log('未检测到心跳事件，准备重新连接');
        reconnect('heartbeat-timeout');
      }
    }, 1000);
  };

  const createAbortController = () => {
    abortCtrlRef.current = new AbortController();
    return abortCtrlRef.current;
  };

  const startSSE = () => {
    if (status !== 1) return;
    hasReceivedSseMessageRef.current = false;
    lastMessageTimeRef.current = Date.now();
    const timestamp = transcriptsList?.at(-1)?.turnStartTime || 0;
    const abortCtrl = createAbortController();
    sseFetch({
      url: `${isDevClient ? '/api' : ''}/in-meeting/recording/start`,
      data: { meetingId: id, timestamp },
      abortCtrl,
      onStart: () => {
        startHeartbeatCheck();
      },
      onMessage: (res) => {
        if (res === 'heartbeat') {
          hasReceivedSseMessageRef.current = true;
          lastMessageTimeRef.current = Date.now();
          reconnectAttemptsRef.current = 0;
        } else {
          hasReceivedSseMessageRef.current = true;
          lastMessageTimeRef.current = Date.now();
          reconnectAttemptsRef.current = 0;
          const sseData = parseChatInsightData(res);
          if (sseData) handleMessage(sseData.type, sseData.data);
        }
      },
      onClose: () => {
        console.log('SSE onClose');
        reconnect('sse-close');
      },
      onError: () => {
        reconnect('sse-error');
      },
    });
  };

  const reconnect = (reason: 'heartbeat-timeout' | 'sse-close' | 'sse-error') => {
    if (isReconnectingRef.current) return;
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.log('达到最大重连次数，停止重连');
      return cleanupSSE();
    }

    isReconnectingRef.current = true;
    reconnectAttemptsRef.current++;
    console.log(
      `尝试重连，第${reconnectAttemptsRef.current}次，原因：${reason}`
    );

    cleanupSSE();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      isReconnectingRef.current = false;
      startSSE();
    }, 2000 * reconnectAttemptsRef.current);
  };

  const cleanupSSE = () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  useEffect(() => {
    getDetail();
  }, []);

  useEffect(() => {
    startSSE();
    return () => {
      cleanupSSE();
    };
  }, []);

  useEffect(() => {
    const userInfoJson = localStorage.getItem('user') || '';
    if (userInfoJson) {
      setUserInfo(JSON.parse(userInfoJson));
    }
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [transcriptsList]);

  return (
    <SwitchBox
      icon="/icons/pencil.svg"
      title="Transcript"
      hiddenSwitch
      className="h-full pb-4"
      scrollRef={messagesContainerRef}
    >
      <div className="flex h-full flex-col gap-3">
        {filteredList?.length ? (
          filteredList.map((item) => {
            return (
              <div
                className="flex gap-4"
                key={`${item.userId}-${item.turnStartTime}`}
              >
                <Avatar name={item.userName} className="shrink-0" size={24} />
                <div className="flex flex-col gap-2 flex-1">
                  <div className="text-gray-iron-600 flex justify-between text-[12px]">
                    <div className="leading-normal max-w-xs truncate">
                      {item.userName || 'unknown'}
                      {item.userId === userInfo?.userId ? ' (You)' : ''}
                    </div>
                    <div>{formatSeconds(item.turnStartTime)}</div>
                  </div>
                  <div className="text-gray-iron-900 leading-6 text-[14px]">
                    {item.transcript}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full flex-col items-center justify-center">
            <Empty />
          </div>
        )}
      </div>
    </SwitchBox>
  );
};

export default Recording;
