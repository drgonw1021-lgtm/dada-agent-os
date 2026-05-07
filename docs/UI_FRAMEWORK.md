# DaDa UI Framework

## Layout

```
┌─────────────── Topbar ──────────────────────┐
│ Logo  DaDa    model  ● ONLINE  TOK:123     │
├────────┬────────────────────────────────────┤
│        │  ContextBar (current task + badge) │
│ Panel  ├────────────────────────────────────┤
│ ← 🗑   │                                    │
│ Proj   │  MessageList                       │
│        │  ┌──────────────────────────┐      │
│ tasks  │  │ user bubble (right)      │      │
│ · t1   │  └──────────────────────────┘      │
│ · t2   │  ┌──────────────────────────┐      │
│ · t3   │  │ agent bubble (left)      │      │
│        │  └──────────────────────────┘      │
│        │                                    │
│ [+New] ├────────────────────────────────────┤
│        │  InputArea + Run button            │
├────────┴────────────────────────────────────┤
│ v0.6.0    Lv.3 ████████░░    0 tasks       │
└────────────── Bottombar ────────────────────┘
```

## Views

### 1. Home View
- Shown when no project is active
- Displays grid of project cards
- Each card: name, description, directory, creation time
- Hover on card → ✕ delete button appears (top-right corner)
- "+ New Project" button opens creation form in drawer
- Click card → enters workspace

### 2. Workspace View (project active)
Left sidebar (`#project-panel`, 300px):
- **Header**: ← back button, project name, task count, 🗑 delete button
- **Body**: scrollable task list, each item shows goal + status badge
- **Footer**: "+ New Task" button (clears selection, focuses input)

Right area (`#chat-workspace`, flex-1):
- **ContextBar**: shows current task name + status badge (hidden when no task selected)
- **MessageList**: chat-style conversation bubbles
  - User messages: right-aligned, accent background
  - Agent responses: left-aligned, surface background
  - Thinking indicator: animated dots during execution
- **InputArea**: textarea + advanced options + Run button
- Cancel bar, timeline, streaming output — hidden in workspace mode

### 3. Standalone Mode (no project)
- Preserves original single-column layout
- Timeline shows execution progress
- Result card shows final output
- `.main.standalone` class applied

## Interaction Flow

```
Home View
  ├── Click project card → enterProjectWorkspace()
  ├── Hover card + click ✕ → deleteProject()
  └── "+ New Project" → open drawer

Workspace
  ├── Click task in sidebar → selectTask()
  │     ├── ContextBar shows task name + status
  │     ├── MessageList shows conversation history
  │     └── Input ready for follow-up
  ├── "+ New Task" → clear selection → type → Run
  │     ├── setupTaskUI() → add user bubble + thinking
  │     ├── startTask() → POST /api/run-async
  │     ├── watchTask() → SSE progress stream
  │     ├── handleProgress() → update thinking text
  │     └── handleTerminal() → replace thinking with agent response
  ├── ← Back button → leaveProjectWorkspace() → Home
  └── 🗑 Delete → confirm → API delete → Home
```

## Key Files

| File | Purpose |
|------|---------|
| `web/index.html` | HTML structure (two-column layout) |
| `web/styles.css` | All styles, CSS variables, responsive |
| `web/app.js` | All frontend logic (~2500 lines) |
| `web/sw.js` | Service Worker (PWA offline cache) |
| `web/manifest.json` | PWA manifest |

## Global State (`S`)

| Field | Type | Purpose |
|-------|------|---------|
| `view` | `'home' \| 'workspace'` | Current view mode |
| `activeProject` | object | Currently active project |
| `activeTaskId` | string | Selected task in workspace |
| `activeProjectTasks` | array | Cached task list for sidebar |
| `taskMessages` | object | `{ [taskId]: [{role,content,time}] }` |
| `currentTask` | object | Running/pending task info |
| `projects` | array | All projects from API |
| `config` | object | Server config |
| `tokenCount` | number | Running token counter |

## API Endpoints Used

| Endpoint | Method | Used In |
|----------|--------|---------|
| `/api/run-async` | POST | `startTask()` |
| `/api/progress?taskId=` | GET (SSE) | `watchTask()` |
| `/api/tasks/status?taskId=` | GET | Polling fallback |
| `/api/tasks/cancel` | POST | `cancelTask()` |
| `/api/tasks/retry` | POST | `retryTask()` |
| `/api/projects` | GET/POST | `loadProjects()` / `createProject()` |
| `/api/projects/:id` | GET/DELETE | Detail / delete |
| `/api/projects/:id/tasks` | GET | `loadProjectTasks()` |
| `/api/tasks` | GET | History drawer |
| `/api/config` | GET | Settings |

## Responsive Behavior

- `> 900px`: Sidebar persistent (300px) + workspace
- `≤ 900px`: Sidebar becomes overlay drawer (toggle), topbar-center hidden
- `≤ 600px`: Compact padding, brand/tokens hidden
- PWA standalone: safe-area-inset for notch devices
- `prefers-reduced-motion`: all animations disabled

## CSS Variables

Defined in `:root` (light) and `[data-theme="dark"]`. Key variables:

```
--bg, --bg-surface, --bg-elevated, --bg-input, --bg-muted, --bg-hover
--border, --border-hover
--text, --text-secondary, --text-muted
--accent, --accent-hover, --accent-bg
--success, --warning, --error (with -bg variants)
--radius-sm (6px), --radius (10px), --radius-lg (14px), --radius-xl (18px)
--topbar-h (48px), --bottombar-h (36px), --drawer-w (380px)
--font (system + CJK), --font-mono
```
