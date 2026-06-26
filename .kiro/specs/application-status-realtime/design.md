# Technical Design: Real-Time Application Status Push

## Overview

The fix adds a single Socket.IO emit call on the backend immediately after every application
status write, and a lightweight socket listener on the frontend that patches the in-memory
application list and shows a toast. No new abstractions are needed — the existing `getIo()` /
`user:<userId>` room pattern used throughout the codebase is reused exactly.

---

## Backend Changes

### File: `backend/src/routes/application.routes.ts`

#### What changes

After the `prisma.application.update()` write (the accepted freelancer) and after the bulk
`prisma.application.updateMany()` (the rejected ones), call `getIo()` and emit
`application:status_changed` to the relevant freelancer rooms.

`getIo` is already imported dynamically elsewhere in this file (`import("../socket")`) — the
same dynamic import pattern is used here to avoid circular dependency issues.

#### Event schema

```ts
interface ApplicationStatusChangedPayload {
  applicationId: string;
  jobId:          string;
  status:         "ACCEPTED" | "REJECTED";
  jobTitle:       string;
}
```

Room target: `user:<freelancerId>` (already joined on socket connect for every authenticated user).

#### Emit points

1. **Accepted application** — after `prisma.application.update()`:
   ```ts
   const { getIo } = await import("../socket");
   getIo().to(`user:${application.freelancerId}`).emit("application:status_changed", {
     applicationId: application.id,
     jobId:         application.jobId,
     status:        "ACCEPTED",
     jobTitle:      application.job.title,
   });
   ```

2. **Bulk-rejected applications** — inside the `for` loop that already iterates
   `rejectedApplications`:
   ```ts
   getIo().to(`user:${rejectedApp.freelancerId}`).emit("application:status_changed", {
     applicationId: rejectedApp.id,
     jobId:         application.jobId,
     status:        "REJECTED",
     jobTitle:      application.job.title,
   });
   ```

3. **Direct rejection** (status === "REJECTED" without going through the acceptance path) —
   after `prisma.application.update()` in the else/fallthrough branch:
   ```ts
   const { getIo } = await import("../socket");
   getIo().to(`user:${application.freelancerId}`).emit("application:status_changed", {
     applicationId: application.id,
     jobId:         application.jobId,
     status:        "REJECTED",
     jobTitle:      application.job.title,
   });
   ```

No changes to the Socket.IO server, auth middleware, room join logic, or notification service.

---

## Frontend Changes

### File: `frontend/src/app/dashboard/page.tsx`

#### What changes

Inside the `useEffect` that already listens for `job:updated` (or the equivalent socket
subscription block), add a listener for `application:status_changed`.

On receipt:
1. Call `setApplications(prev => prev.map(...))` to patch the matching card's `status` field
   in-place — no API call, no full refetch.
2. Call `toast.success(...)` or `toast.error(...)` depending on the incoming status.

#### Socket subscription (to add)

```ts
// already available via useSocket()
const { socket } = useSocket();
// already available via useToast()
const { toast } = useToast();

useEffect(() => {
  if (!socket) return;

  const handler = ({
    applicationId,
    status,
    jobTitle,
  }: {
    applicationId: string;
    status: "ACCEPTED" | "REJECTED";
    jobTitle: string;
  }) => {
    // 1. Patch in-place — no refetch
    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId ? { ...app, status } : app
      )
    );

    // 2. Update stats counters
    setStats((prev) => ({
      ...prev,
      pendingApplications:  Math.max(0, prev.pendingApplications - 1),
      acceptedApplications: status === "ACCEPTED" ? prev.acceptedApplications + 1 : prev.acceptedApplications,
      rejectedApplications: status === "REJECTED" ? prev.rejectedApplications + 1 : prev.rejectedApplications,
    }));

    // 3. Toast
    const verb = status === "ACCEPTED" ? "accepted" : "rejected";
    if (status === "ACCEPTED") {
      toast.success(`Your application for "${jobTitle}" was accepted.`);
    } else {
      toast.error(`Your application for "${jobTitle}" was rejected.`);
    }
  };

  socket.on("application:status_changed", handler);
  return () => { socket.off("application:status_changed", handler); };
}, [socket, toast]);
```

The `setApplications` spread preserves every other field on the card (bid, proposal, dates),
so no layout shift occurs. The `StatusBadge` component re-renders only the badge element.

#### Why no refetch

The event payload contains all fields needed to update the UI (`applicationId`, `status`,
`jobTitle`). Triggering `fetchDashboardData()` would re-render the entire tab and reset scroll
position — the in-place patch avoids this entirely.

---

## Tests

### Backend test

**File:** `backend/src/__tests__/application-status-socket.test.ts`

- Mock `getIo` to return a spy object `{ to: jest.fn().mockReturnThis(), emit: jest.fn() }`
- Call the route handler with `status: "ACCEPTED"` — assert `emit` was called with
  `"application:status_changed"` and the correct payload for the accepted freelancer
- Assert `emit` was called once per entry in `rejectedApplications` with `status: "REJECTED"`
- Repeat with `status: "REJECTED"` directly — assert single emit to the freelancer's room

### Frontend test

**File:** `frontend/src/__tests__/dashboard-application-socket.test.tsx`

- Render the dashboard component with mocked `useSocket` returning a mock socket
- Simulate `socket.emit("application:status_changed", { applicationId, status: "ACCEPTED", jobTitle })`
- Assert the matching application card now shows `StatusBadge` with `ACCEPTED`
- Assert `toast.success` was called with the correct message
- Assert `fetchDashboardData` / API fetch was NOT called

---

## Affected Files Summary

| File | Change |
|------|--------|
| `backend/src/routes/application.routes.ts` | Add `getIo().to(...).emit("application:status_changed", ...)` after each status write |
| `frontend/src/app/dashboard/page.tsx` | Add `socket.on("application:status_changed", handler)` with in-place state patch + toast |
| `backend/src/__tests__/application-status-socket.test.ts` | New test — backend emit assertions |
| `frontend/src/__tests__/dashboard-application-socket.test.tsx` | New test — frontend handler assertions |

No schema migrations, no new dependencies, no changes to `SocketContext`, `ToastProvider`,
`NotificationService`, or any other file.
