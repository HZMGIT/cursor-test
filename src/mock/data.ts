import { User } from "@/types";

// Mock user data
export const mockUsers: User[] = [
  {
    id: "1",
    name: "Alice Johnson",
    email: "alice@example.com",
    role: "admin",
    status: "active",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Alice",
    createdAt: "2024-01-15",
  },
  {
    id: "2",
    name: "Bob Smith",
    email: "bob@example.com",
    role: "editor",
    status: "active",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Bob",
    createdAt: "2024-02-20",
  },
  {
    id: "3",
    name: "Charlie Brown",
    email: "charlie@example.com",
    role: "viewer",
    status: "inactive",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Charlie",
    createdAt: "2024-03-10",
  },
  {
    id: "4",
    name: "Diana Prince",
    email: "diana@example.com",
    role: "admin",
    status: "active",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Diana",
    createdAt: "2024-04-05",
  },
  {
    id: "5",
    name: "Edward Norton",
    email: "edward@example.com",
    role: "editor",
    status: "active",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Edward",
    createdAt: "2024-05-18",
  },
  {
    id: "6",
    name: "Fiona Apple",
    email: "fiona@example.com",
    role: "viewer",
    status: "active",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Fiona",
    createdAt: "2024-06-22",
  },
  {
    id: "7",
    name: "George Lucas",
    email: "george@example.com",
    role: "editor",
    status: "inactive",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=George",
    createdAt: "2024-07-14",
  },
  {
    id: "8",
    name: "Hannah Montana",
    email: "hannah@example.com",
    role: "viewer",
    status: "active",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=Hannah",
    createdAt: "2024-08-30",
  },
];

// In-memory store for mock data (simulates a database)
let users = [...mockUsers];
let nextId = 9;

export function getUsers() {
  return [...users];
}

export function getUserById(id: string) {
  return users.find((u) => u.id === id) || null;
}

export function createUser(
  data: Omit<User, "id" | "createdAt" | "avatar">
): User {
  const newUser: User = {
    ...data,
    id: String(nextId++),
    avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${data.name.replace(/\s/g, "")}`,
    createdAt: new Date().toISOString().split("T")[0],
  };
  users.push(newUser);
  return newUser;
}

export function updateUser(
  id: string,
  data: Partial<Omit<User, "id" | "createdAt">>
): User | null {
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return null;
  users[index] = { ...users[index], ...data };
  return users[index];
}

export function deleteUser(id: string): boolean {
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return false;
  users.splice(index, 1);
  return true;
}

export function resetUsers() {
  users = [...mockUsers];
  nextId = 9;
}
