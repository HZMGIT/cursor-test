# Audio WebSocket Flow

## 启动录制时序

```mermaid
sequenceDiagram
    autonumber
    participant UI as StartRecording 页面
    participant Hook as useAudioWebSocket(index.ts)
    participant Flow as executeStartRecording(recordingFlow.ts)
    participant Shared as sharedState.ts
    participant Cross as crossTabState.ts
    participant Audio as globalAudioManager
    participant WS as globalWebSocketManager
    participant Mon as webSocketMonitor
    participant Sess as recordingSession

    UI->>Hook: startRecording(options)
    Hook->>Flow: executeStartRecording(options, deps)

    Flow->>Audio: isRecordingActive()
    alt 已在录制
        Flow->>WS: getMeetingId()
        alt 同会议且 WS 未连接
            Flow->>Hook: connectWebSocket(meetingId)
            Hook->>WS: connect(url)
        end
        Flow-->>Hook: {started:true/false, reason}
    else 未在录制
        Flow->>Shared: isGlobalStartInProgress()
        alt 全局正在启动
            Flow-->>Hook: already-starting
        else 可启动
            Flow->>Cross: acquireStartRecordingMutex()
            alt mutex 获取失败
                Flow-->>Hook: mutex-not-acquired
            else mutex 成功
                Flow->>Shared: setGlobalStartInProgress(true)

                loop 最多 8 次轮询
                    Flow->>Mon: cleanupExpiredConnections()
                    Flow->>Mon: forceCleanupLikelyStaleConnections(TTL)
                    Flow->>Cross: clearStaleGlobalRecordingLockIfSafe()
                    Flow->>Mon: hasActiveConnection()/hasConnectionInThisTab()
                    Flow->>Cross: hasRecentGlobalRecordingLock()
                end

                alt 其他标签页占用
                    Flow-->>Hook: notifyOtherTabRecording()
                    Flow-->>Hook: active-connection-exists
                else 可继续
                    Flow->>Audio: requestPermissions()
                    alt 麦克风拒绝
                        Flow-->>Hook: onPermissionDenied(error)
                        Flow-->>Hook: permission-denied
                    else 权限通过
                        alt options 无 meetingId
                            Flow->>UI: onMeetingCreate()
                            UI-->>Flow: meetingId
                        end
                        Flow->>Shared: setGlobalStartMeetingId(meetingId)
                        Flow->>Hook: connectWebSocket(meetingId)
                        Hook->>WS: setMeetingId(meetingId)
                        Hook->>WS: connect(url)

                        Flow->>Audio: startRecordingFromStreams()
                        alt 启动成功
                            Flow->>Cross: clearRecentStopMark()
                            Flow->>Sess: save(meetingId)
                            Flow->>Cross: setGlobalRecordingLock(meetingId)
                            Flow->>Mon: connect(meetingId)
                            Flow->>Mon: updateActiveTime(meetingId)
                            Flow-->>Hook: started
                        else 启动失败
                            Flow-->>Hook: onError("启动录制失败")
                            Flow-->>Hook: start-recording-failed
                        end
                    end
                end

                Flow->>Shared: resetGlobalStartState()
                Flow->>Cross: releaseStartRecordingMutex(ownerId)
            end
        end
    end

    Hook-->>UI: StartRecordingResult
```

### 启动链路方法注释

- `startRecording(options)`：对外入口，触发完整的“检查 -> 权限 -> 建连 -> 开录”流程。
- `executeStartRecording(options, deps)`：启动主流程实现，统一处理成功/失败分支与清理逻辑。
- `isGlobalStartInProgress()`：检查是否已有标签页正在执行启动流程，避免并发启动。
- `acquireStartRecordingMutex()`：跨标签抢占启动互斥锁，防止重复弹权限。
- `requestPermissions()`：申请麦克风/屏幕权限，失败时直接中断流程。
- `onMeetingCreate()`：在无 `meetingId` 场景下由业务侧创建会议并返回 ID。
- `connectWebSocket(meetingId)`：设置会话 `meetingId` 并连接音频 WebSocket。
- `startRecordingFromStreams()`：在权限流就绪后开始音频采集与切片发送。
- `setGlobalRecordingLock(meetingId)`：写入跨标签“正在录制”标记，避免其他页误启动。
- `resetGlobalStartState()`：在 `finally` 中重置全局启动状态，确保下次可重试。

## 运行期与停止时序

```mermaid
sequenceDiagram
    autonumber
    participant UI as InMeeting 页面
    participant Hook as useAudioWebSocket(index.ts)
    participant Audio as globalAudioManager
    participant WS as globalWebSocketManager
    participant Mon as webSocketMonitor
    participant Cross as crossTabState.ts
    participant Sess as recordingSession

    Note over Hook: 运行期订阅
    Hook->>WS: addOpen/Close/Message/ErrorListener
    Hook->>WS: subscribeToState(setConnectionState)
    Hook->>Audio: subscribe(setIsRecording/setRecordingTime)

    alt isRecording=true
        loop 每 2s
            Hook->>Mon: updateActiveTime(meetingId)
            Hook->>Cross: setGlobalRecordingLock(meetingId)
        end
    end

    Note over UI,Hook: stopRecording（仅停止采集）
    UI->>Hook: stopRecording()
    Hook->>Audio: stopRecording()
    Hook->>Mon: disconnect()
    Hook->>Sess: clear()
    Hook->>Cross: hardResetCrossTabRecordingState()
    Hook->>Cross: setRecentStopMark()

    Note over UI,Hook: endSession（结束会话）
    UI->>Hook: endSession()
    Hook->>Audio: stopRecording()
    Hook->>Audio: releasePermissions()
    Hook->>WS: disconnect()
    Hook->>Mon: disconnect()
    Hook->>Sess: clear()
    Hook->>Cross: hardResetCrossTabRecordingState()
    Hook->>Cross: setRecentStopMark()

    Note over UI,Hook: logout 兜底
    UI->>Hook: stopRecordingForLogout()
    Hook->>Hook: stopRecordingIfActive()
    Hook->>Audio: stopRecording/releasePermissions
    Hook->>WS: disconnect()
    Hook->>Mon: disconnect()
    Hook->>Sess: clear()
    Hook->>Cross: hardReset... + setRecentStopMark()
```

### 运行期/停止链路方法注释

- `addOpen/Close/Message/ErrorListener`：绑定 WebSocket 生命周期事件，回传连接状态和消息。
- `subscribeToState(setConnectionState)`：订阅底层连接状态机，驱动 Hook 的 `isConnected/isConnecting`。
- `subscribe(setIsRecording/setRecordingTime)`：订阅录制状态与时长，驱动 UI 展示。
- `updateActiveTime(meetingId)`：周期更新活跃时间，防止监控记录被误清理。
- `stopRecording()`：只停采集，不强制断网，适合暂停场景。
- `endSession()`：结束会话，执行“停采集 + 释放权限 + 断网 + 清状态”全清理。
- `stopRecordingForLogout()`：登出兜底入口，内部复用 `stopRecordingIfActive()`。
- `hardResetCrossTabRecordingState()`：清理跨标签残留锁与监控状态，避免“幽灵占用”。
- `setRecentStopMark()`：打最近停止标记，协助下次启动阶段自愈判定。

## 模块职责图

```mermaid
flowchart LR
  IDX[index.ts\nHook 编排层] --> FLOW[recordingFlow.ts\n开始录制主链路]
  IDX --> SUB[subscriptions.ts\nWS/Audio 订阅]
  IDX --> PERM[permission.ts\n权限查询与监听]
  IDX --> GUARD[sessionGuards.ts\n会话存在判断/登出停止]
  FLOW --> CROSS[crossTabState.ts\n跨标签锁/互斥/beforeunload]
  FLOW --> STATE[sharedState.ts\n全局启动状态]
  IDX --> TYPES[types.ts\n统一类型]
  IDX --> GAM[lib/audio/GlobalAudioManager.ts\n权限/采集/分片发送]
  IDX --> GWSM[lib/websocket/GlobalWebSocketManager.ts\nWS连接状态机/重连]
  IDX --> WSMON[lib/websocket/webSocketMonitor.ts\n跨标签连接监控]
  IDX --> RSESSION[lib/audio/recordingSession.ts\n会话持久化恢复]
  IDX --> APKT[lib/audio/audioPacket.ts\n音频包封装]
  FLOW --> GAM
  FLOW --> GWSM
  FLOW --> WSMON
  FLOW --> RSESSION
  SUB --> GWSM
  SUB --> GAM
  GUARD --> GAM
  GUARD --> GWSM
  GUARD --> WSMON
  GUARD --> RSESSION
```

### 跨模块关键方法注释

- `hasOngoingRecordingSession()`：统一判断“当前是否存在活跃录制会话”。
- `stopRecordingIfActive()`：统一执行会话级停止与资源回收（常用于登出/兜底）。
- `createMicrophonePermissionChecker()`：构造权限查询函数，封装权限 API 与 fallback。
- `cleanupPermissionStatusListener()`：移除权限状态监听，避免组件卸载后的更新。
- `bindWebSocketSubscriptions()`：集中绑定/解绑 WebSocket 事件与状态订阅。
- `bindAudioManagerSubscription()`：集中绑定/解绑音频状态订阅与回调触发。

## 业务视角简化图

```mermaid
flowchart TD
    A[点击 Start Recording] --> B[申请权限]
    B --> B1{麦克风权限通过?}
    B1 -- 否 --> B2[提示权限拒绝并结束]
    B1 -- 是 --> C[创建会议或获取 meetingId]

    C --> C1{meetingId 有效?}
    C1 -- 否 --> C2[提示创建失败并结束]
    C1 -- 是 --> D[建立 WebSocket 连接]
    D --> E[启动本地录音采集]
    E --> E1{启动成功?}
    E1 -- 否 --> E2[提示启动失败并结束]
    E1 -- 是 --> F[进入录制中]

    F --> G[持续推送音频到 WS]
    F --> H[持续接收 SSE 转写]
    F --> I[更新连接状态与录制时长]

    G --> G1{WS 异常?}
    G1 -- 否 --> F
    G1 -- 是 --> G2[自动重连 WS]
    G2 --> G3{自动重连成功?}
    G3 -- 是 --> F
    G3 -- 否 --> G4[显示连接异常]
    G4 --> G5[用户点击 Try Again]
    G5 --> G6[先重连 WS 再重试 SSE]
    G6 --> F

    H --> H1{SSE 异常?}
    H1 -- 否 --> F
    H1 -- 是 --> H2[SSE 自动重试]
    H2 --> H3{重试成功?}
    H3 -- 是 --> F
    H3 -- 否 --> G4

    F --> J{结束触发}
    J -- 用户点 Stop --> J1[停止录音]
    J -- 用户点 End Session --> J2[停止录音+断开WS]
    J -- 登出/会议结束事件 --> J3[统一清理]

    J1 --> K[清理会话与跨标签状态]
    J2 --> K
    J3 --> K
    K --> L[录制流程结束]
```
