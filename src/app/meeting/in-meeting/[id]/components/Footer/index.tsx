/*
 * @Description: Footer
 * @Author: guangyu.ran@msxf.com
 * @Date: 2025-10-16 14:34:26
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { WaveLoading } from "@/components/Loading";
import Wavesurfer from "../Wavesurfer";
import { recordingStop, recordingRetry } from "@/api/in-meeting";
import { useRouter } from "next/navigation";
import { handleRequest, gaSend } from "@/lib/utils";
import { wsEventBus } from "../../observer";
import { ConnectionState } from "@/lib/websocket/GlobalWebSocketManager";
import BaseIcon from "@/components/BaseIcon";

type FooterProps = {
  id: string;
  status: number;
  type?: string;
  sourceType?: number;
  hasActiveRecording?: boolean;
  onDisconnect?: () => void;
  retryConnect?: () => void;
  connectionState: ConnectionState;
  microphonePermission?: "granted" | "denied" | "prompt" | "unknown";
};

const Footer: React.FC<FooterProps> = (props) => {
  const {
    id,
    status: meetingStatus,
    type,
    sourceType,
    hasActiveRecording = false,
    onDisconnect,
    retryConnect,
    connectionState,
    microphonePermission,
  } = props;
  const [status, setStatus] = useState("normal");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const recordStatus = useMemo(() => {
    switch (connectionState) {
      case "connected":
        return "normal";
      case "reconnecting":
        return "loading";
      case "failed":
        return "error";
      case "disconnected":
      default:
        return "other";
    }
  }, [connectionState]);

  const stop = async () => {
    setLoading(true);
    await handleRequest(
      () => recordingStop({ meetingId: id }),
      async () => {
        setLoading(false);
        router.replace(`/meeting/after-meeting/${id}?from=1`);
      },
    );
  };

  const stopRecord = async () => {
    setLoading(true);
    try {
      await handleRequest(
        () => recordingStop({ meetingId: id }),
        async () => {
          onDisconnect?.();
          router.push(`/meeting/after-meeting/${id}?from=1`);
        },
      );
    } catch (error) {
      // handleRequest 内部可能已经处理了错误，这里可以处理额外的错误逻辑
      console.error("Stop recording failed:", error);
    } finally {
      setLoading(false); // 确保无论成功失败都会执行
    }
  };

  const handleRetry = async () => {
    gaSend("in_meeting_reconnect");
    await handleRequest(() => recordingRetry({ meetingId: id }), () => {});
  };

  const handleDisconnect = (typeCode: number) => {
    switch (typeCode) {
      case 1:
      case 2:
      case 5:
        setStatus("normal");
        break;
      case 3:
        setStatus("loading");
        break;
      case 4:
        setStatus("error");
        break;
    }
  };

  useEffect(() => {
    wsEventBus.on("disconnected", handleDisconnect);
    return () => {
      wsEventBus.off("disconnected", handleDisconnect);
    };
  }, []);

  const stopBtn =
    meetingStatus === 1 ? (
      <Button
        variant="destructive"
        className="font-bold"
        onClick={stop}
        disabled={loading}
      >
        <BaseIcon name="stop" /> Stop
      </Button>
    ) : null;

  const componentMap: Record<string, React.ReactNode> = {
    normal: (
      <div className="flex items-center gap-4 w-full">
        <Wavesurfer />
        {stopBtn}
      </div>
    ),
    loading: (
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 flex justify-center items-center">
          <WaveLoading size={48} center={<BaseIcon name="info-circle" />} />
        </div>
        <div className="text-gray-iron-900">
          Connection lost. Reconnecting...
        </div>
        {stopBtn}
      </div>
    ),
    error: (
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 flex justify-center items-center bg-error-200 rounded-[50%]">
          <BaseIcon name="close-red" />
        </div>
        <div className="text-gray-iron-900">Sorry, Unable to Reconnect</div>
        <Button className="font-bold" onClick={handleRetry}>
          <BaseIcon name="refresh-cw-01" /> Try Again
        </Button>
        {stopBtn}
      </div>
    ),
  };

  const recordStopBtn = (
    <Button
      variant="destructive"
      className="font-bold"
      onClick={stopRecord}
      disabled={loading}
    >
      <BaseIcon name="stop" /> Stop
    </Button>
  );

  const recordComponentMap: Record<string, React.ReactNode> = {
    normal: (
      <div className="flex items-center gap-4 w-full">
        <Wavesurfer
          type={type}
          sourceType={sourceType}
          isConnected={connectionState === "connected"}
          microphonePermission={microphonePermission}
        />
        {recordStopBtn}
      </div>
    ),
    loading: (
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 flex justify-center items-center">
          <WaveLoading size={48} center={<BaseIcon name="info-circle" />} />
        </div>
        <div className="text-gray-iron-900">
          Connection lost. Reconnecting...
        </div>
        {recordStopBtn}
      </div>
    ),
    error: (
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 flex justify-center items-center bg-error-200 rounded-[50%]">
          <BaseIcon name="close-red" />
        </div>
        <div className="text-gray-iron-900">Sorry, Unable to Reconnect</div>
        <Button className="font-bold" onClick={retryConnect}>
          <BaseIcon name="refresh-cw-01" />
          Try Again
        </Button>
        {recordStopBtn}
      </div>
    ),
    other: <div className="flex items-center gap-4">{recordStopBtn}</div>,
  };

  console.log("是否是主页面》》》hasActiveRecording", hasActiveRecording);

  if (meetingStatus !== 1) return <div className="pb-4 flex-shrink-0"></div>;

  const shouldUseRecordFooter =
    sourceType === 4 && (hasActiveRecording || connectionState === "failed");

  return (
    <div className="pt-4 pb-4 flex-shrink-0">
      <div className="flex justify-center p-3 bg-white rounded-[12px]">
        {shouldUseRecordFooter
          ? recordComponentMap[recordStatus]
          : componentMap[status]}
      </div>
    </div>
  );
};

export default Footer;
