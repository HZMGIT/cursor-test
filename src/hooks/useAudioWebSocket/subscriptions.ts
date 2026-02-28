import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { globalAudioManager } from '@/lib/audio/GlobalAudioManager';
import {
  globalWebSocketManager,
  type ConnectionState,
} from '@/lib/websocket/GlobalWebSocketManager';
import type { AudioWebSocketCallbacks } from './types';

interface BindWebSocketDeps {
  isMountedRef: MutableRefObject<boolean>;
  callbacksRef: MutableRefObject<AudioWebSocketCallbacks>;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
}

export const bindWebSocketSubscriptions = ({
  isMountedRef,
  callbacksRef,
  setConnectionState,
}: BindWebSocketDeps) => {
  const handleOpen = () => {
    if (!isMountedRef.current) return;
    callbacksRef.current.onStatusChange?.('connected');
  };

  const handleClose = () => {
    if (!isMountedRef.current) return;
    callbacksRef.current.onStatusChange?.('disconnected');
  };

  const handleMessage = (event: MessageEvent) => {
    if (!isMountedRef.current) return;
    callbacksRef.current.onMessage?.(event.data);
  };

  const handleError = () => {
    if (!isMountedRef.current) return;
    callbacksRef.current.onError?.('WebSocket connection error');
  };

  globalWebSocketManager.addOpenListener(handleOpen);
  globalWebSocketManager.addCloseListener(handleClose);
  globalWebSocketManager.addMessageListener(handleMessage);
  globalWebSocketManager.addErrorListener(handleError);

  const unsubscribeState = globalWebSocketManager.subscribeToState((state) => {
    if (!isMountedRef.current) return;
    setConnectionState(state);
  });

  return () => {
    globalWebSocketManager.removeOpenListener(handleOpen);
    globalWebSocketManager.removeCloseListener(handleClose);
    globalWebSocketManager.removeMessageListener(handleMessage);
    globalWebSocketManager.removeErrorListener(handleError);
    unsubscribeState();
  };
};

interface BindAudioDeps {
  isMountedRef: MutableRefObject<boolean>;
  lastRecordingStateRef: MutableRefObject<boolean>;
  callbacksRef: MutableRefObject<AudioWebSocketCallbacks>;
  setIsRecording: Dispatch<SetStateAction<boolean>>;
  setRecordingTime: Dispatch<SetStateAction<number>>;
  sampleRate: number;
  chunkDurationMs: number;
  sendAudioData: (
    audioData: Float32Array,
    type: 'microphone' | 'screenShare' | 'mixed'
  ) => void;
}

export const bindAudioManagerSubscription = ({
  isMountedRef,
  lastRecordingStateRef,
  callbacksRef,
  setIsRecording,
  setRecordingTime,
  sampleRate,
  chunkDurationMs,
  sendAudioData,
}: BindAudioDeps) => {
  globalAudioManager.setAudioParams(sampleRate, chunkDurationMs);
  globalAudioManager.setSendAudioDataCallback(sendAudioData);

  const unsubscribe = globalAudioManager.subscribe((state) => {
    if (!isMountedRef.current) return;

    setIsRecording(state.isRecording);
    setRecordingTime(state.recordingTime);

    if (state.isRecording && !lastRecordingStateRef.current) {
      lastRecordingStateRef.current = true;
      callbacksRef.current.onRecordingStart?.();
      callbacksRef.current.onStatusChange?.('recording');
    } else if (!state.isRecording && lastRecordingStateRef.current) {
      lastRecordingStateRef.current = false;
      callbacksRef.current.onRecordingStop?.();
      callbacksRef.current.onStatusChange?.('stopped');
    }
  });

  return () => {
    unsubscribe();
  };
};
