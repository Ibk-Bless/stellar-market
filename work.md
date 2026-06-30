#604 Add notification centre with bell icon and read/unread state
Repo Avatar
stellarmarket-labs/stellar-market
Overview
Users receive no in-app notifications. Add a bell icon in the navbar that shows a badge count and a dropdown list of recent notifications.

Requirements
Notification types: new job application, milestone released, dispute opened, message received, review posted
Bell icon badge shows unread count (capped at 99+)
Dropdown shows last 20 notifications with timestamp and action link
Mark-all-as-read button
Clicking a notification marks it read and navigates to the relevant page
Poll GET /notifications?unread=true every 30 s (upgrade to WebSocket in a follow-up)
Acceptance Criteria
Badge disappears after all notifications are read
Notifications older than 30 days not shown
Accessible: dropdown traps focus and closes on Escape

#740 Freelancer profile page has no 'Request to Hire' CTA when viewed by a client — conversion path is missing
Repo Avatar
stellarmarket-labs/stellar-market

Problem
A client browsing a freelancer profile has no direct action to initiate hiring. The profile page is read-only with no CTA. Clients must navigate away to job posting and manually enter the freelancer details, creating unnecessary friction and drop-off.

Root Cause
The freelancer profile page was built for public viewing with no role-aware CTAs.

Required Changes
Frontend
Detect viewer role from auth context.
If the viewer is a client and the profile belongs to a freelancer, show a "Invite to Job" button.
Clicking "Invite to Job" opens a modal to select an existing open job (from the client job list) to invite the freelancer to, or a link to post a new job.
The invitation is recorded as POST /jobs/:id/invitations { freelancerId } and shown in the freelancer notification centre.
Backend
Add POST /jobs/:id/invitations and GET /jobs/:id/invitations (client-only). Store in an Invitation model.

Tests
Client viewer sees "Invite to Job" button.
Freelancer viewer does not see the button.
Invitation is created successfully via the modal.
Acceptance Criteria
Client sees "Invite to Job" CTA on freelancer profiles
Non-client viewers do not see the CTA
Invitation is persisted and appears in freelancer notifications

#742 Wallet balance is fetched on every dashboard render — no caching causes redundant Horizon calls
Repo Avatar
stellarmarket-labs/stellar-market
Problem
The dashboard header fetches the connected wallet XLM balance from Horizon on every render via freighter.getBalance() or a direct Horizon account call. This results in multiple Horizon calls per minute during active sessions, adding latency and contributing to rate-limit risk.

Root Cause
Balance is fetched in a useEffect with no cache or stale-time configuration.

Required Changes
Frontend
Move balance fetching into a TanStack Query hook useWalletBalance with staleTime: 30_000 (30 seconds).
Refresh on window focus if the cached value is older than 30 seconds.
Show the cached balance immediately while a background refresh is in progress.
Display a subtle "↻" icon while refreshing.
Tests
Balance is served from cache on second mount within 30 seconds.
Window focus triggers a background refresh after 30 seconds.
Acceptance Criteria
Balance is not re-fetched more than once per 30 seconds per session
Stale balance is shown immediately while refreshing
Background refresh indicator is visible

#744 Recharts earnings chart is not responsive on screen widths below 375px — chart overflows on small Android devices
Repo Avatar
stellarmarket-labs/stellar-market
Problem
The ComposedChart in the earnings dashboard uses a fixed width prop. On screens narrower than 375px (common on budget Android devices), the chart overflows its container and creates a horizontal scroll on the dashboard.

Root Cause
width={600} is hardcoded on the ComposedChart component instead of using ResponsiveContainer.

Required Changes
Frontend
Wrap the ComposedChart in .
Remove the hardcoded width prop.
On screens < 375px, reduce bar size and hide the moving average line label to avoid clutter.
Verify on Chrome DevTools device emulation for Galaxy A13 (360px wide).
Tests
Render at 320px width — verify no horizontal overflow.
Render at 375px — verify chart fills container.
Acceptance Criteria
Chart fills its container at all viewport widths
No horizontal scroll on screens < 375px
Moving average line remains visible at 375px
