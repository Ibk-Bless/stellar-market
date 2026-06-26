# Implementation Tasks: Real-Time Application Status Push

## Tasks

- [ ] 1. Emit `application:status_changed` for accepted application
  - In `backend/src/routes/application.routes.ts`, inside the `PUT /applications/:id/status` handler, after the `prisma.application.update()` call and before the `if (status === "ACCEPTED")` block, add a dynamic import of `getIo` and emit `application:status_changed` to `user:<application.freelancerId>` with payload `{ applicationId: application.id, jobId: application.jobId, status, jobTitle: application.job.title }` when status is `"ACCEPTED"`
  - **Verify:** The emit fires with the correct room and payload shape

- [ ] 2. Emit `application:status_changed` for bulk-rejected applications
  - In the same handler, inside the `for (const rejectedApp of rejectedApplications)` loop (which already sends the rejection notification), add a `getIo().to(\`user:${rejectedApp.freelancerId}\`).emit("application:status_changed", { applicationId: rejectedApp.id, jobId: application.jobId, status: "REJECTED", jobTitle: application.job.title })` call after the `NotificationService.sendNotification` call
  - **Verify:** Each rejected freelancer's room receives its own emit

- [ ] 3. Emit `application:status_changed` for direct rejection
  - After the accepted branch, handle the case where `status === "REJECTED"` is sent directly (no bulk-reject path). After `prisma.application.update()`, add a dynamic import and emit `application:status_changed` to `user:<application.freelancerId>` with `status: "REJECTED"` and `jobTitle: application.job.title`
  - **Verify:** Direct rejection emits exactly one event to the correct room

- [ ] 4. Subscribe to `application:status_changed` in the dashboard and patch cards in-place
  - In `frontend/src/app/dashboard/page.tsx`, import `useToast` from `@/components/Toast` if not already imported
  - Add a `useEffect` that depends on `socket` — register `socket.on("application:status_changed", handler)` and return `socket.off("application:status_changed", handler)` for cleanup
  - In the handler, call `setApplications(prev => prev.map(app => app.id === applicationId ? { ...app, status } : app))` to update the card without a refetch
  - Also update `stats` counters: decrement `pendingApplications` by 1, increment `acceptedApplications` or `rejectedApplications` based on incoming status
  - **Verify:** Application card status badge updates in-place; no API call is triggered

- [ ] 5. Show a toast notification on status change
  - Inside the same `application:status_changed` handler from Task 4, call `toast.success(\`Your application for "${jobTitle}" was accepted.\`)` when `status === "ACCEPTED"` and `toast.error(\`Your application for "${jobTitle}" was rejected.\`)` when `status === "REJECTED"`
  - **Verify:** Toast appears within 1 second; uses correct verb and job title

- [ ] 6. Write backend test for socket emit on status change
  - Create `backend/src/__tests__/application-status-socket.test.ts`
  - Mock `prisma.application.findUnique`, `prisma.application.update`, `prisma.application.findMany`, `prisma.application.updateMany`, `prisma.job.update`, `NotificationService.sendNotification`, and `getIo`
  - Test 1: PUT with `status: "ACCEPTED"` — assert `getIo().to("user:<freelancerId>").emit("application:status_changed", { ..., status: "ACCEPTED" })` was called
  - Test 2: Bulk-reject path — assert emit called once per entry in rejectedApplications with `status: "REJECTED"`
  - Test 3: PUT with `status: "REJECTED"` directly — assert single emit with `status: "REJECTED"`
  - **Verify:** All 3 test cases pass; no real DB or socket calls made

- [ ] 7. Write frontend test for in-place card update without refetch
  - Create `frontend/src/__tests__/dashboard-application-socket.test.tsx`
  - Render the dashboard with mocked `useSocket` returning a mock socket and mocked `useAuth`/`useToast`
  - Simulate the `application:status_changed` event by calling the registered handler directly
  - Assert the card for the matching `applicationId` now renders with the new status
  - Assert `toast.success` was called with the expected message
  - Assert the data-fetch function (`fetchDashboardData` or the internal fetch) was NOT called as a result of the event
  - **Verify:** All assertions pass
