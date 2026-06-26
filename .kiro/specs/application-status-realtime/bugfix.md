# Bugfix Requirements Document

## Introduction

When a client accepts or rejects a job application via `PUT /applications/:id/status`, the
resulting status change is persisted to the database but no real-time event is pushed to the
affected freelancer. Consequently, the freelancer's application list on the dashboard only
reflects the new status after a manual page refresh or the next full data reload. For
time-sensitive offers this delay can cause freelancers to miss acceptance windows or submit
redundant applications. The fix must emit a `application:status_changed` Socket.IO event to
the freelancer's room immediately after every accepted or rejected status transition, and the
frontend must handle that event by updating the application card in-place and showing a toast
notification — without triggering a full data refetch.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a client sends `PUT /applications/:id/status` with `status: "ACCEPTED"` THEN the system writes the status to the database but does not emit any Socket.IO event to the freelancer room, leaving the freelancer's application list stale until a manual refresh.

1.2 WHEN a client sends `PUT /applications/:id/status` with `status: "REJECTED"` THEN the system writes the status to the database but does not emit any Socket.IO event to the freelancer room, leaving the freelancer's application list stale until a manual refresh.

1.3 WHEN a client accepts one application and all other pending applications are bulk-rejected THEN the system does not emit Socket.IO events to any of the other rejected freelancers, so their application cards also remain stale.

1.4 WHEN the freelancer's dashboard is open and their application status changes THEN no toast notification appears and the application card status badge does not update in-place, causing the freelancer to be unaware of the change.

### Expected Behavior (Correct)

2.1 WHEN a client sends `PUT /applications/:id/status` with `status: "ACCEPTED"` THEN the system SHALL emit a `application:status_changed` event with payload `{ applicationId, jobId, status: "ACCEPTED", jobTitle }` to the `user:<freelancerId>` Socket.IO room immediately after the database write.

2.2 WHEN a client sends `PUT /applications/:id/status` with `status: "REJECTED"` THEN the system SHALL emit a `application:status_changed` event with payload `{ applicationId, jobId, status: "REJECTED", jobTitle }` to the `user:<freelancerId>` Socket.IO room immediately after the database write.

2.3 WHEN a client accepts one application and other pending applications are bulk-rejected THEN the system SHALL emit a `application:status_changed` event with `status: "REJECTED"` to the `user:<freelancerId>` room for each affected freelancer.

2.4 WHEN the freelancer's dashboard receives an `application:status_changed` event THEN the system SHALL update the matching application card's status badge in-place without triggering a full data refetch.

2.5 WHEN the freelancer's dashboard receives an `application:status_changed` event THEN the system SHALL display a toast notification reading "Your application for {jobTitle} was accepted." or "Your application for {jobTitle} was rejected." depending on the incoming status.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a freelancer submits a new application via `POST /jobs/:jobId/apply` THEN the system SHALL CONTINUE TO create the application record, notify the client, and emit the existing `job:updated` event without any change.

3.2 WHEN a client views the list of applications for a job via `GET /jobs/:jobId/applications` THEN the system SHALL CONTINUE TO return the paginated application list with freelancer details unchanged.

3.3 WHEN the Socket.IO connection is established THEN the system SHALL CONTINUE TO authenticate via JWT and join the `user:<userId>` room as before.

3.4 WHEN any existing notification (e.g. `notification:new`) is emitted THEN the system SHALL CONTINUE TO deliver it to the freelancer's room without interference from the new `application:status_changed` event.

3.5 WHEN a freelancer withdraws a pending application via `DELETE /applications/:id` THEN the system SHALL CONTINUE TO delete the application record and return HTTP 204 without any change.

3.6 WHEN a client accepts an application THEN the system SHALL CONTINUE TO update the job status to `IN_PROGRESS`, assign the freelancer, and bulk-reject all other pending applications as before.
