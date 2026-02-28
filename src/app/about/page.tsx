import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function AboutPage() {
  const techStack = [
    {
      name: "Next.js",
      version: "16",
      description: "React framework with App Router, API Routes, and SSR support",
      category: "Framework",
    },
    {
      name: "React",
      version: "19",
      description: "JavaScript library for building user interfaces",
      category: "UI Library",
    },
    {
      name: "TypeScript",
      version: "5",
      description: "Typed superset of JavaScript for better developer experience",
      category: "Language",
    },
    {
      name: "Tailwind CSS",
      version: "4",
      description: "Utility-first CSS framework for rapid UI development",
      category: "Styling",
    },
    {
      name: "shadcn/ui",
      version: "latest",
      description:
        "Beautiful, accessible components built with Radix UI and Tailwind CSS",
      category: "Components",
    },
    {
      name: "Mock Server",
      version: "-",
      description:
        "Built-in Next.js API Routes as mock server with in-memory data store",
      category: "Backend",
    },
  ];

  const apiEndpoints = [
    { method: "GET", path: "/api/users", description: "List all users (supports search, role, status filters)" },
    { method: "POST", path: "/api/users", description: "Create a new user" },
    { method: "GET", path: "/api/users/:id", description: "Get user by ID" },
    { method: "PUT", path: "/api/users/:id", description: "Update user by ID" },
    { method: "DELETE", path: "/api/users/:id", description: "Delete user by ID" },
    { method: "GET", path: "/api/stats", description: "Get dashboard statistics" },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">About This Project</h1>
        <p className="text-muted-foreground mt-1">
          A full-stack demo application showcasing modern web development tools
        </p>
      </div>

      <Separator />

      {/* Tech Stack */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Tech Stack</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {techStack.map((tech) => (
            <Card key={tech.name}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{tech.name}</CardTitle>
                  <Badge variant="outline">{tech.version}</Badge>
                </div>
                <CardDescription className="text-xs">
                  {tech.category}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {tech.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      {/* API Endpoints */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Mock API Endpoints</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {apiEndpoints.map((endpoint, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <Badge
                    variant={
                      endpoint.method === "GET"
                        ? "default"
                        : endpoint.method === "POST"
                          ? "secondary"
                          : endpoint.method === "DELETE"
                            ? "destructive"
                            : "outline"
                    }
                    className="mt-0.5 min-w-[60px] justify-center font-mono text-xs"
                  >
                    {endpoint.method}
                  </Badge>
                  <div>
                    <code className="text-sm font-semibold">{endpoint.path}</code>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {endpoint.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Project Structure */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Project Structure</h2>
        <Card>
          <CardContent className="pt-6">
            <pre className="text-sm text-muted-foreground leading-relaxed overflow-x-auto">
{`src/
├── app/
│   ├── api/              # Mock Server (API Routes)
│   │   ├── users/
│   │   │   ├── route.ts        # GET (list) & POST (create)
│   │   │   └── [id]/
│   │   │       └── route.ts    # GET, PUT, DELETE by ID
│   │   └── stats/
│   │       └── route.ts        # Dashboard statistics
│   ├── about/
│   │   └── page.tsx      # About page
│   ├── globals.css       # Global styles (Tailwind + shadcn)
│   ├── layout.tsx        # Root layout with navigation
│   └── page.tsx          # Dashboard page
├── components/
│   ├── ui/               # shadcn/ui components
│   ├── add-user-dialog.tsx
│   ├── stat-card.tsx
│   └── user-table.tsx
├── lib/
│   └── utils.ts          # Utility functions
├── mock/
│   └── data.ts           # Mock data & in-memory store
└── types/
    └── index.ts          # TypeScript type definitions`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
