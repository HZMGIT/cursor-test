let globalStartInProgress = false;
let globalStartMeetingId: string | null = null;

export const isGlobalStartInProgress = () => globalStartInProgress;

export const setGlobalStartInProgress = (inProgress: boolean) => {
  globalStartInProgress = inProgress;
};

export const getGlobalStartMeetingId = () => globalStartMeetingId;

export const setGlobalStartMeetingId = (meetingId: string | null) => {
  globalStartMeetingId = meetingId;
};

export const resetGlobalStartState = () => {
  globalStartInProgress = false;
  globalStartMeetingId = null;
};
