import type { MutableRefObject } from 'react';

export const cleanupPermissionStatusListener = (
  permissionStatusRef: MutableRefObject<PermissionStatus | null>
) => {
  if (!permissionStatusRef.current) return;
  permissionStatusRef.current.onchange = null;
  permissionStatusRef.current = null;
};

export const createMicrophonePermissionChecker = (
  permissionStatusRef: MutableRefObject<PermissionStatus | null>,
  setMicrophonePermission: (
    permission: 'granted' | 'denied' | 'prompt' | 'unknown'
  ) => void
) => {
  return async (): Promise<boolean> => {
    // 清理上一次的监听
    cleanupPermissionStatusListener(permissionStatusRef);

    // 1. 尝试使用 Permissions API（Chrome 支持，Firefox 部分版本不支持 'microphone'）
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permissionStatus = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });

        permissionStatusRef.current = permissionStatus;
        setMicrophonePermission(permissionStatus.state as any);

        permissionStatus.onchange = () => {
          setMicrophonePermission(permissionStatus.state as any);
        };

        return permissionStatus.state === 'granted';
      } catch {
        // Firefox 不支持查询 'microphone' 权限，走下面的 fallback
        console.warn(
          'Permissions API does not support "microphone" query, using fallback'
        );
      }
    }

    // 2. Fallback：不再主动调用 getUserMedia（避免在页面初始化阶段触发权限弹窗）
    // 对于不支持 Permissions API 查询的浏览器/环境，保持 unknown，
    // 真实权限申请只在 startRecording -> requestPermissions 中发生。
    setMicrophonePermission('unknown');
    return false;
  };
};
