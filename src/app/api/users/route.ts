import { NextRequest, NextResponse } from "next/server";
import { getUsers, createUser } from "@/mock/data";

// GET /api/users - Get all users with optional filtering
export async function GET(request: NextRequest) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  let users = getUsers();

  // Filter by role
  if (role && role !== "all") {
    users = users.filter((u) => u.role === role);
  }

  // Filter by status
  if (status && status !== "all") {
    users = users.filter((u) => u.status === status);
  }

  // Search by name or email
  if (search) {
    const keyword = search.toLowerCase();
    users = users.filter(
      (u) =>
        u.name.toLowerCase().includes(keyword) ||
        u.email.toLowerCase().includes(keyword)
    );
  }

  return NextResponse.json({
    success: true,
    data: users,
    total: users.length,
  });
}

// POST /api/users - Create a new user
export async function POST(request: NextRequest) {
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    const body = await request.json();
    const { name, email, role, status } = body;

    if (!name || !email || !role || !status) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    const newUser = createUser({ name, email, role, status });

    return NextResponse.json(
      { success: true, data: newUser, message: "User created successfully" },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid request body" },
      { status: 400 }
    );
  }
}
