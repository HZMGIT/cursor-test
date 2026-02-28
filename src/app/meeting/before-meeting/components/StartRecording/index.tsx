/*
 * @Description: start recording
 * @Author: zhenmei.he@msxf.com
 * @Date: 2026-01-30 15:57:49
 */
'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createBrowser } from '@/api/record';
import { useToast } from '@/components/hooks/use-toast';
import {
  getGlobalWebSocketManager,
  hasActiveAudioRecording,
  useAudioWebSocket,
} from '@/hooks/useAudioWebSocket/index';
import { recordingSession } from '@/lib/audio/recordingSession';
import { useRouter } from 'next/navigation';
import { gaSend } from '@/lib/utils';
import NotifyPopup from '@/components/NotifyPopup';

type StartRecordingProps = {
  open: boolean;
  onCancel: () => void;
};

const StartRecording: React.FC<StartRecordingProps> = (props) => {
  const [open, setOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [isStartingMeeting, setIsStartingMeeting] = useState(false);
  const [permissionError, setPermissionError] = useState<React.ReactNode>(null);
  const { toast } = useToast();
  const router = useRouter();

  const { startRecording } = useAudioWebSocket({
    sampleRate: 16000,
    chunkDurationMs: 200,
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
    onPermissionGranted: () => {
      console.log('麦克风权限已授予');
      setPermissionError(null);
    },
  });

  useEffect(() => {
    setOpen(props.open);
    if (props.open) {
      setPermissionError(null);
    }
  }, [props.open]);

  const formSchema = z.object({
    language: z.string(),
    meetingName: z
      .string()
      .min(1, {
        message: 'MeetingName is required',
      })
      .max(100, {
        message: 'Rule cannot exceed 100 characters',
      }),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      meetingName: '',
      language: 'en',
    },
  });

  const handleNewMeeting = async () => {
    if (isStartingMeeting) return;
    setIsStartingMeeting(true);
    setPermissionError(null);

    try {
      let createdMeetingId = '';
      const result = await startRecording({
        onMeetingCreate: async () => {
          const { data } = await createBrowser({
            title: form.getValues('meetingName'),
            description: form.getValues('language'),
          });
          createdMeetingId = data.meetingId;
          return data.meetingId;
        },
      });

      const isMeetingSessionReady = (meetingId: string) => {
        const wsManager = getGlobalWebSocketManager();
        const state = wsManager.getConnectionState();
        const wsMeetingId = wsManager.getMeetingId();
        return (
          recordingSession.hasPendingSession(meetingId) ||
          (hasActiveAudioRecording() &&
            wsMeetingId === meetingId &&
            (state === 'connected' || state === 'reconnecting'))
        );
      };

      const waitForSessionReady = async (
        meetingId: string,
        timeoutMs = 1200,
        intervalMs = 250
      ) => {
        const maxLoops = Math.ceil(timeoutMs / intervalMs);
        for (let i = 0; i < maxLoops; i++) {
          if (isMeetingSessionReady(meetingId)) return true;
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        return false;
      };

      // 会议创建成功后优先跳会中：
      // - result.started=true：立即跳转
      // - result.started=false 且可重试：先短等待会话收敛，再跳转
      // - result.started=false 且不可重试：仍跳转，由会中页自动拉起/恢复
      if (createdMeetingId && result.started) {
        // 仅在录制主链路真正启动成功时，写入会中“直通恢复”标记
        localStorage.setItem('ONGOING_RECORD_MEETING_ID', createdMeetingId);
        props.onCancel();
        router.push(`/meeting/in-meeting/${createdMeetingId}?type=record`);
        return;
      }

      // 对可重试类失败做温和兜底：等待会话状态收敛，避免线上时序误判
      if (createdMeetingId && !result.started && result.retryable) {
        const ready = await waitForSessionReady(createdMeetingId);
        if (!ready) {
          console.warn(
            'startRecording retryable but not ready before navigation',
            {
              reason: result.reason,
              meetingId: createdMeetingId,
            }
          );
        }
      }

      if (createdMeetingId) {
        props.onCancel();
        router.push(`/meeting/in-meeting/${createdMeetingId}?type=record`);
        return;
      }

      // 麦克风权限拒绝时，使用 onPermissionDenied 内的 toast 提示，
      // 这里不再追加通用初始化失败提示，避免误导用户。
      if (
        !createdMeetingId &&
        !result.started &&
        result.reason !== 'permission-denied'
      ) {
        toast({
          description: 'Recording initialization failed. Please retry.',
          variant: 'warning',
        });
      }
    } finally {
      setIsStartingMeeting(false);
    }
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values);

    try {
      const isValid = await form.trigger();
      if (isValid) {
        gaSend('start_recording');
        handleNewMeeting();
      }
    } catch (error) {
      console.error('提交过程中出错:', error);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            console.log('cancel');
            props.onCancel();
          }
        }}
      >
        <DialogContent className="w-[508px]">
          <DialogHeader>
            <DialogTitle>New recording</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <FormControl>
                      <Select {...field} onValueChange={() => {}}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem key="1" value="en">
                              English
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="meetingName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        size="sm"
                        placeholder="Recording title"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <p className="text-sm">
                <span>
                  Recording requires enabling browser permissions. See
                  documentation:{` `}
                  <a
                    href="/browser-perms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#1456f0] hover:bg-[#f0f4ff]/80"
                  >
                    How to enable browser recording permissions
                  </a>
                </span>
              </p>
              <DialogFooter>
                <div className="w-full flex gap-4 mt-6">
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => {
                      setOpen(false);
                      props.onCancel();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={isStartingMeeting}
                  >
                    Start Recording
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <NotifyPopup
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        showMask
        title="Oops, your plan is running out..."
        description="Your leftover minutes are shorter than this meeting Wait for the monthly refresh,"
        hintText="or email us for more:"
        email="hello@sales-savvy.ai"
        imageSrc="/images/pricing/image 52.png"
        goItText="Got it!"
        onGoIt={() => setNotifyOpen(false)}
      />
    </>
  );
};

export default StartRecording;