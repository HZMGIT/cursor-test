/*
 * @Description: Wavesurfer
 * @Author: weixing.dong-n@msxf.com
 * @Date: 2026-01-09
 */
"use client";

import Amplitude, { AmplitudeRef } from "@/components/Amplitude";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { TranscriptItemType } from "@/types/in-meeting";
import { wsEventBus } from "../../observer";
import { LiveWaveform } from "@/components/ui/live-waveform";

const Wavesurfer = ({
  type,
  isConnected,
  microphonePermission,
}: {
  type?: string;
  isConnected?: boolean;
  microphonePermission?: "granted" | "denied" | "prompt" | "unknown";
}) => {
  const amplitudeRef = useRef<AmplitudeRef>(null);
  const [item, setItem] = useState<TranscriptItemType>();
  const [userInfo, setUserInfo] = useState<any>({});
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const play = () => {
    amplitudeRef.current?.startPlay();
  };

  const showName = (info: TranscriptItemType) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setItem(info);
    timerRef.current = setTimeout(() => {
      setItem(undefined);
      timerRef.current = null;
    }, 1000);
  };

  const onMessage = (data: TranscriptItemType[]) => {
    const info = data[0];
    showName(info);
    play();
  };

  useEffect(() => {
    const userInfoJson = localStorage.getItem("user") || "";
    if (userInfoJson) {
      setUserInfo(JSON.parse(userInfoJson));
    }
  }, []);

  useEffect(() => {
    wsEventBus.on("speaking", onMessage);
    return () => {
      wsEventBus.off("speaking", onMessage);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const micGranted = microphonePermission === "granted";

  return (
    <>
      {item && (
        <div className="flex">
          <Avatar name={item?.userName} className="shrink-0 mr-2" size={36} />
          <div>
            <div className="leading-[20px] w-[120px] truncate text-[14px] text-gray-900">
              {item?.userName}
              {item?.userId === userInfo?.userId ? " (You)" : ""}
            </div>
            <div className="text-[12px] text-gray-900">Speaking...</div>
          </div>
        </div>
      )}

      {type === "record" ? (
        <LiveWaveform
          // keep mounted and avoid Date.now() re-mount loop
          active={Boolean(isConnected) && micGranted}
          micPermissionGranted={micGranted}
          mode="static"
          barColor="#EF6820"
          onStreamEnd={() => {
            // stream released
          }}
        />
      ) : (
        <Amplitude ref={amplitudeRef} className="flex-1" />
      )}
    </>
  );
};

export default Wavesurfer;
