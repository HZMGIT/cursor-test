import { NextResponse } from "next/server";
import { getUsers } from "@/mock/data";

// GET /api/stats - Get dashboard statistics
export async function GET() {
  await new Promise((resolve) => setTimeout(resolve, 200));

  const users = getUsers();

  const stats = {
    totalUsers: users.length,
    activeUsers: users.filter((u) => u.status === "active").length,
    adminCount: users.filter((u) => u.role === "admin").length,
    editorCount: users.filter((u) => u.role === "editor").length,
    viewerCount: users.filter((u) => u.role === "viewer").length,
  };

  return NextResponse.json({ success: true, data: stats });
}
