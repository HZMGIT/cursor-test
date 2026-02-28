# MyApp - Next.js + shadcn/ui + Mock Server

A full-stack demo application built with modern web technologies, featuring a user management dashboard with built-in mock API server.

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| **Next.js** | 16 | React framework (App Router) |
| **React** | 19 | UI library |
| **TypeScript** | 5 | Type-safe development |
| **Tailwind CSS** | 4 | Utility-first styling |
| **shadcn/ui** | latest | UI component library |
| **Mock Server** | built-in | Next.js API Routes as mock backend |

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## Features

- **User Dashboard** - View, search, filter, add, and delete users
- **Statistics Cards** - Real-time stats (total users, active users, etc.)
- **Mock API Server** - Full CRUD API with in-memory data store
- **Responsive Design** - Works on desktop and mobile
- **Modern UI** - Built with shadcn/ui components

## Mock API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/users` | List users (supports `?search=`, `?role=`, `?status=`) |
| `POST` | `/api/users` | Create a new user |
| `GET` | `/api/users/:id` | Get user by ID |
| `PUT` | `/api/users/:id` | Update user |
| `DELETE` | `/api/users/:id` | Delete user |
| `GET` | `/api/stats` | Get dashboard statistics |

### Example API Usage

```bash
# Get all users
curl http://localhost:3000/api/users

# Search users
curl http://localhost:3000/api/users?search=alice

# Filter by role
curl http://localhost:3000/api/users?role=admin

# Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"New User","email":"new@example.com","role":"editor","status":"active"}'

# Delete a user
curl -X DELETE http://localhost:3000/api/users/1
```

## Project Structure

```
src/
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
│   ├── globals.css       # Global styles
│   ├── layout.tsx        # Root layout
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
    └── index.ts          # TypeScript type definitions
```
