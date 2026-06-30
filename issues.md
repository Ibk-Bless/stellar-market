#733 PWA install prompt is shown on every session — users who dismissed it see it again on every page load
Repo Avatar
stellarmarket-labs/stellar-market
Problem
PushNotificationPrompt and the PWA install banner are shown on every mount regardless of whether the user has previously dismissed or accepted them. This is intrusive and erodes trust.

Root Cause
No persistence of the user decision exists — the component does not check localStorage before rendering.

Required Changes
Frontend
On dismiss, write pwa_prompt_dismissed: true and pwa_prompt_dismissed_at: to localStorage.
On mount, read localStorage and skip rendering if dismissed within the last 30 days.
On accept (permission granted), write pwa_prompt_accepted: true to localStorage and never show again.
Provide a way to re-surface the prompt from the user settings page ("Enable notifications").
Tests
Dismiss prompt — verify it does not render on next mount.
After 31 days (mock Date.now), verify it renders again.
Acceptance Criteria
 Dismissed prompt does not re-appear within 30 days
 Accepted prompt never re-appears
 User can re-enable from settings
Effort Estimate
1 day

Labels
frontend enhancement ux


#736 Frontend has no global loading indicator for slow navigations — the app appears frozen during page transitions
Repo Avatar
stellarmarket-labs/stellar-market
Problem
Next.js App Router does not show a native loading bar between route transitions when data fetching happens server-side. Users on slow connections see a frozen UI for 1–3 seconds with no indication that navigation is in progress.

Root Cause
No top-level loading bar or progress indicator is wired into the router.

Required Changes
Frontend
Install nprogress (or implement a custom top-of-page progress bar).
Wire it to the useRouter navigation events using the App Router usePathname/useSearchParams change detection pattern.
Start the bar on navigation start, complete on the new page render.
Match the bar colour to the brand accent colour.
Tests
Simulate a slow navigation (mock delay) — verify progress bar is visible.
Fast navigation — verify bar appears and completes without flickering.
Acceptance Criteria
 Progress bar appears at the top of the page on every navigation
 Bar completes when the new page renders
 No flash or double-render of the bar
Effort Estimate
< 1 day

Labels
frontend enhancement ux


#735 Dispute raise modal does not show escrow balance before submission — clients may raise disputes on already-empty escrows
Repo Avatar
stellarmarket-labs/stellar-market
Problem
The RaiseDisputeModal collects dispute details and submits without first showing the current escrow balance. If the escrow has already been partially or fully released, the client is unaware and may raise a dispute expecting funds that are not there.

Root Cause
The modal does not fetch or display the escrow state before allowing submission.

Required Changes
Frontend
On modal open, call GET /escrow/:jobId to fetch current balance and milestone release status.
Display a summary: "Escrow balance: X XLM — Y of Z milestones released."
If balance is 0, show a warning: "This escrow has no remaining balance. Raising a dispute will not result in a payout."
Allow submission regardless (the dispute may still be valid for reputational reasons).
Tests
Modal with non-zero balance shows the balance summary.
Modal with zero balance shows the warning banner.
Acceptance Criteria
 Escrow balance is shown before dispute submission
 Zero-balance warning is clear and visible
 User can still submit despite zero balance
Effort Estimate
1 day

Labels
frontend enhancement ux


#732 Freelancer profile has no availability status toggle — clients cannot tell if a freelancer is actively taking work
Repo Avatar
stellarmarket-labs/stellar-market
Problem
Freelancer profiles show no availability signal. A client browsing profiles has no way to know if a freelancer is actively accepting jobs, currently at capacity, or on a break. This leads to applications being sent to unavailable freelancers and slow response times eroding client trust.

Root Cause
No availabilityStatus field exists on the freelancer profile model.

Required Changes
Backend
Add availabilityStatus: "available" | "busy" | "unavailable" to the FreelancerProfile Prisma model.
Default to "available" on profile creation.
Add PATCH /freelancers/me/availability { status } with freelancer auth.
Include availabilityStatus in the public profile response.
Frontend
Add a toggle/select on the freelancer dashboard settings: "Available", "Busy", "Unavailable".
Render a coloured badge on the freelancer profile card and detail page: green / amber / grey.
Clients browsing job applications see the badge next to each applicant name.
Tests
PATCH /freelancers/me/availability updates the field.
Non-freelancer cannot call the endpoint.
Public profile response includes the status.
Acceptance Criteria
 Freelancer can set availability from their dashboard
 Status badge is visible on profile cards and detail pages
 Clients see availability status on job applicant lists
Effort Estimate
1–2 days

Labels
frontend backend enhancement


git pull and merge from the upstream and merge with my forked repo 
origin  git@github.com:EmdevelopaOpenSource/stellar-market.git (fetch)
origin  git@github.com:EmdevelopaOpenSource/stellar-market.git (push)
upstream        https://github.com/stellarmarket-labs/stellar-market (fetch)
upstream        https://github.com/stellarmarket-labs/stellar-market (push)
solodev@solodev:~/Documents/dripsNetwork/stellar-market$ 
then i updated the issue.md file.. fix the isssues inside and update the pr.md file with the replace issue fixed

help push the code also..
