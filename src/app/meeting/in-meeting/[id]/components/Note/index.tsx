/*
 * @Description: Note
 * @Author: guangyu.ran@msxf.com
 * @Date: 2025-10-15 20:21:12
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import SwitchBox from "@/components/SwitchBox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/hooks/use-toast";
import { noteSave } from "@/api/in-meeting";
import { handleRequest, gaSend } from "@/lib/utils";
import { Tour } from "@/components/Tour";
import { IN_MEETING_STEPS } from "@/constants/TourConfig";
import { useRequest } from "ahooks";
import { useChannel } from "@/hooks/useChannel";
import { finishGuide, getGuideStatus } from "@/api/user";

type NoteProps = {
  id: string;
  content?: string;
};

const maxLen = 5000;

const Note: React.FC<NoteProps> = (props) => {
  const { id, content } = props;
  const [text, setText] = useState(content || "");
  const timeoutRef = useRef<NodeJS.Timeout>(null);
  const hasTriggeredTourRef = useRef(false);
  const hasRequestedGuideStatusRef = useRef(false);
  const { channel } = useChannel();
  const [tourStep, setTourStep] = useState<0 | 1 | null>(0);
  const [isTourOpen, setIsTourOpen] = useState(false);

  // 获取导引状态
  const { run: getGuideStatusRun } = useRequest(
    () => getGuideStatus<boolean>(3),
    {
      manual: true,
      onSuccess: (data) => {
        console.log("data", data);
        if (!data.data && !hasTriggeredTourRef.current) {
          hasTriggeredTourRef.current = true;
          console.log("开始引导");
          gaSend(`tour_3_start`);
          setIsTourOpen(true);
        }
      },
    },
  );

  // 用户操作引导完成接口
  const { run: finishGuideRun } = useRequest(() => finishGuide(3), {
    manual: true,
    onSuccess: (data) => {
      console.log("data", data);
      if (data.code === "200") {
        console.log("引导完成");
      }
    },
  });

  useEffect(() => {
    if (hasRequestedGuideStatusRef.current) return;
    hasRequestedGuideStatusRef.current = true;
    getGuideStatusRun();
  }, []);

  // 保存输入
  const handleSave = async (value?: string) => {
    gaSend("in_meeting_update_note");
    await handleRequest(
      () => noteSave({ meetingId: id, content: value || text }),
      async () => {
        // const { data: { note = '' } } = await queryInMeetingDetail(id!);
        // setText(note);
      },
    );
  };

  // 处理输入变化
  const handleChange = (value: string) => {
    if (value && value.length === maxLen) {
      toast({
        description: "Limit reached (5,000 characters)",
        variant: "warning",
      });
    }
    setText(value);

    // 清除之前的定时器
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // 停止输入3秒则自动保存
    timeoutRef.current = setTimeout(() => {
      handleSave(value);
    }, 3000);
  };

  // 处理失焦事件
  const handleBlur = (value: string) => {
    // 清除定时器，避免重复保存
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // 立即保存
    handleSave(value);
  };

  useEffect(() => {
    channel.onmessage = (event) => {
      if (event.data.type === "Unauthorized") {
        toast({
          variant: "warning",
          description: "Session expired. Your last edits might not be saved.",
        });
      }
    };
  }, [channel]);

  return (
    <>
      <SwitchBox
        icon="/icons/book.svg"
        title="Notes"
        className="h-full"
        childClassName="pr-0"
        elId="in-notes"
      >
        <div className="h-full">
          <Textarea
            placeholder="Enter text..."
            noBorder={true}
            className="h-full border-0 pr-4 resize-none text-gray-iron-900 leading-5 caret-gray-500"
            containerClassName="rounded-none"
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            // 点击空白处，失焦的时候也触发
            onBlur={(e) => handleBlur(e.target.value)}
            maxLength={maxLen}
          />
        </div>
      </SwitchBox>

      <Tour
        steps={IN_MEETING_STEPS}
        open={isTourOpen}
        current={tourStep!}
        autoAdjust={true} // 自动调整位置
        recalcWhenChange={false} // 避免会中频繁布局变化引发引导抖动
        recalcOnScroll={false} // 避免滚动时重复重算导致闪烁
        scrollIntoViewOptions={{ behavior: "auto", block: "center" }} // 禁止平滑滚动造成重复动画
        animated={false} // 关闭动画，稳定展示
        showIndicator={false}
        showPrevButton={false}
        maskColor="rgba(0, 0, 0, 0.6)"
        onFinish={() => {
          gaSend(`tour_3_finish`);
          setTourStep(null);
          setIsTourOpen(false);
          finishGuideRun();
        }}
        onClose={() => {
          gaSend(`tour_3_close`);
          setIsTourOpen(false);
          finishGuideRun();
        }}
        mask={false} // 可以全局关闭遮罩层
      />
    </>
  );
};

export default React.memo(Note);
