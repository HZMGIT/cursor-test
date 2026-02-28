/**
 * meeting - in_meeting
 * @ps: 会议 - 会议中
 */
import React from "react";
import InMeetingClient from "./InMeetingClient";
import { queryMeetingDetail } from "@/api/before-meeting";
import { queryInMeetingDetail } from "@/api/in-meeting";
import { redirect } from "next/navigation";

export const metadata = {
  title: "meeting",
};

const InMeetingPage: React.FC<PageProps<"/meeting/in-meeting/[id]">> = async ({
  params,
  searchParams,
}) => {
  const { id } = await params;
  const searchParamsObj = await searchParams;
  const type = searchParamsObj?.type || "";

  const [res, detailRes] = await Promise.all([
    queryMeetingDetail(id!),
    queryInMeetingDetail(id!),
  ]);

  const {
    transcripts = [],
    goals = [],
    note = "",
    status = 0,
  } = detailRes?.data || {};

  console.log("meetingDetail>>>>", detailRes?.data);

  // 2录制结束 3会议结束，跳转到话后
  if (status === 2 || status === 3) {
    redirect(`/meeting/after-meeting/${id}`);
  }

  return (
    <InMeetingClient
      id={id}
      type={type as string}
      meetingData={res?.data}
      meetingDetail={detailRes?.data}
    />
  );
};

export default InMeetingPage;
