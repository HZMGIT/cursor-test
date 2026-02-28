"use client";

import { useEffect, useState, useCallback } from "react";
import { User } from "@/types";
import { StatCard } from "@/components/stat-card";
import { UserTable } from "@/components/user-table";
import { AddUserDialog } from "@/components/add-user-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Users, UserCheck, Shield, Search, RefreshCw } from "lucide-react";

interface Stats {
  totalUsers: number;
  activeUsers: number;
  adminCount: number;
  editorCount: number;
  viewerCount: number;
}

export default function DashboardPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/users?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setUsers(json.data);
      }
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      const json = await res.json();
      if (json.success) {
        setStats(json.data);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchStats();
  }, [fetchUsers, fetchStats]);

  const handleAddUser = async (userData: {
    name: string;
    email: string;
    role: "admin" | "editor" | "viewer";
    status: "active" | "inactive";
  }) => {
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData),
      });
      const json = await res.json();
      if (json.success) {
        fetchUsers();
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to add user:", err);
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        fetchUsers();
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to delete user:", err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          User management dashboard powered by Next.js, shadcn/ui & Mock Server
        </p>
      </div>

      <Separator />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={stats?.totalUsers ?? "..."}
          description="All registered users"
          icon={Users}
        />
        <StatCard
          title="Active Users"
          value={stats?.activeUsers ?? "..."}
          description="Currently active"
          icon={UserCheck}
        />
        <StatCard
          title="Admins"
          value={stats?.adminCount ?? "..."}
          description="Administrator accounts"
          icon={Shield}
        />
        <StatCard
          title="Editors"
          value={stats?.editorCount ?? "..."}
          description="Content editors"
          icon={Users}
        />
      </div>

      <Separator />

      {/* Filters & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => fetchUsers()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <AddUserDialog onAdd={handleAddUser} />
        </div>
      </div>

      {/* User Table */}
      <UserTable
        users={users}
        loading={loading}
        onDelete={handleDeleteUser}
      />

      {/* Footer */}
      <div className="text-center text-sm text-muted-foreground py-4">
        <p>
          Mock API: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/api/users</code>{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/api/users/:id</code>{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/api/stats</code>
        </p>
      </div>
    </div>
  );
}
