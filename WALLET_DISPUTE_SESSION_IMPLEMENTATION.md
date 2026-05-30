# Wallet Connection, Dispute Notifications & Session Management Implementation

## Overview

This document outlines the implementation of three key features for the Stellar Market platform:

1. **Enhanced Freighter Wallet Connection** - Improved wallet integration with session management
2. **Dispute Status Notifications** - Real-time in-app and email notifications for dispute events
3. **Wallet Disconnect & Session Management** - Secure session handling with automatic expiry

---

## Feature 1: Enhanced Freighter Wallet Connection

### Implementation Details

#### Frontend Changes (`frontend/src/context/WalletContext.tsx`)

**New Session Management:**

- Session timeout: 30 minutes of inactivity
- Session warning: 5 minutes before expiry
- Automatic session extension on user activity
- Session persistence in localStorage

**New State Properties:**

```typescript
isSessionActive: boolean;           // Whether wallet session is active
sessionExpiresIn: number | null;    // Milliseconds until session expires
extendSession: () => void;          // Function to extend session
```

**Session Lifecycle:**

1. **Connection**: User connects wallet → Session created with timestamp
2. **Activity**: Any wallet action (transaction, account switch) → Session extended
3. **Warning**: 5 minutes before expiry → `stellarmarket:sessionWarning` event dispatched
4. **Expiry**: 30 minutes of inactivity → Auto-disconnect with `stellarmarket:sessionExpired` event

**Key Functions:**

- `saveSession(address)` - Creates new session
- `updateSessionActivity()` - Extends session timeout
- `clearSession()` - Clears session data
- `getStoredSession()` - Retrieves stored session

**Event Listeners:**

- `freighter#accountChanged` - Handles account switching with session update
- `freighter#disconnected` - Handles wallet disconnection
- `visibilitychange` - Re-verifies connection when tab becomes visible

### Usage Example

```typescript
import { useWallet } from "@/context/WalletContext";

export function WalletComponent() {
  const {
    address,
    connect,
    disconnect,
    isSessionActive,
    sessionExpiresIn,
    extendSession
  } = useWallet();

  // Listen for session warning
  useEffect(() => {
    const handleSessionWarning = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log(`Session expires in ${detail.expiresIn}ms`);
      // Show warning UI
    };

    window.addEventListener("stellarmarket:sessionWarning", handleSessionWarning);
    return () => window.removeEventListener("stellarmarket:sessionWarning", handleSessionWarning);
  }, []);

  // Listen for session expiry
  useEffect(() => {
    const handleSessionExpired = () => {
      console.log("Session expired - user disconnected");
      // Show expiry message
    };

    window.addEventListener("stellarmarket:sessionExpired", handleSessionExpired);
    return () => window.removeEventListener("stellarmarket:sessionExpired", handleSessionExpired);
  }, []);

  return (
    <div>
      {address ? (
        <>
          <p>Connected: {address}</p>
          <p>Session Active: {isSessionActive}</p>
          {sessionExpiresIn && (
            <p>Expires in: {Math.round(sessionExpiresIn / 1000)}s</p>
          )}
          <button onClick={extendSession}>Extend Session</button>
          <button onClick={disconnect}>Disconnect</button>
        </>
      ) : (
        <button onClick={connect}>Connect Wallet</button>
      )}
    </div>
  );
}
```

---

## Feature 2: Dispute Status Notifications

### Implementation Details

#### Backend Changes

**Dispute Service (`backend/src/services/dispute.service.ts`)**

**Notification Triggers:**

1. **Dispute Raised** (`createDispute`)
   - Sent to: Client and Freelancer
   - Type: `DISPUTE_RAISED`
   - Batching: Skipped (urgent)
   - Email: Sent if preference enabled

2. **Vote Cast** (`castVote`)
   - Sent to: Client and Freelancer
   - Type: `DISPUTE_RAISED` (vote update)
   - Message: Indicates vote choice (client/freelancer)
   - Batching: Normal

3. **Dispute Resolved** (`resolveDispute`)
   - Sent to: Client and Freelancer
   - Type: `DISPUTE_RESOLVED`
   - Batching: Skipped (urgent)
   - Email: Sent with outcome details

**Notification Service (`backend/src/services/notification.service.ts`)**

**Email Support:**

- Added `DISPUTE_RESOLVED` event type
- Outcome metadata passed to email template
- Conditional sending based on `NotificationPreference`

**Email Templates:**

1. **Dispute Opened** (`dispute-opened.ts`)
   - Existing template
   - Notifies about dispute initiation
   - Includes action link to dispute details

2. **Dispute Resolved** (`dispute-resolved.ts`) - NEW
   - Shows resolution outcome (client/freelancer)
   - Indicates job completion
   - Includes action link to job details

### Database Schema

**Notification Types:**

```prisma
enum NotificationType {
  // ... existing types
  DISPUTE_RAISED
  DISPUTE_RESOLVED
  // ... other types
}
```

**Notification Preferences:**

```prisma
model NotificationPreference {
  userId                 String   @id
  emailEnabled           Boolean  @default(true)
  emailDisputeOpened     Boolean  @default(true)  // Covers both RAISED and RESOLVED
  // ... other preferences
}
```

### API Integration

**Dispute Routes** (`backend/src/routes/dispute.routes.ts`)

Existing endpoints automatically trigger notifications:

- `POST /api/disputes` - Create dispute
- `POST /api/disputes/:id/votes` - Cast vote
- `PATCH /api/disputes/:id/resolve` - Resolve dispute

### Real-time Socket Events

**Socket.IO Emissions:**

```typescript
// Emitted to user:${userId} room
io.to(`user:${userId}`).emit("notification:new", {
  id: string;
  userId: string;
  type: "DISPUTE_RAISED" | "DISPUTE_RESOLVED";
  title: string;
  message: string;
  metadata: {
    disputeId: string;
    jobId: string;
    initiatorId?: string;
    voterId?: string;
    outcome?: string;
  };
  read: boolean;
  createdAt: Date;
});
```

### Usage Example

```typescript
// Frontend - Listen for dispute notifications
import { useSocket } from "@/context/SocketContext";

export function DisputeNotifications() {
  const { socket } = useSocket();

  useEffect(() => {
    socket?.on("notification:new", (notification) => {
      if (notification.type === "DISPUTE_RAISED") {
        showAlert(`Dispute raised: ${notification.message}`);
      } else if (notification.type === "DISPUTE_RESOLVED") {
        showAlert(`Dispute resolved: ${notification.message}`);
      }
    });

    return () => {
      socket?.off("notification:new");
    };
  }, [socket]);

  return null;
}
```

---

## Feature 3: Wallet Disconnect & Session Management

### Implementation Details

#### Disconnect Handling

**Automatic Disconnect Triggers:**

1. User clicks "Disconnect" button
2. Wallet extension is removed/disabled
3. Wallet is locked
4. Account access is revoked
5. Session timeout (30 minutes)

**Disconnect Flow:**

```
User Action / Event
    ↓
Verify Wallet Status
    ↓
Clear Local State (address, balance, balances)
    ↓
Clear Storage (STORAGE_KEY, SESSION_KEY)
    ↓
Clear Timeouts (session timeout, warning)
    ↓
Dispatch "stellarmarket:walletDisconnected" Event
    ↓
Notify Other Components
```

**State Cleanup:**

```typescript
const disconnect = useCallback(() => {
  setAddress(null);
  setError(null);
  setBalance(null);
  setBalances([]);
  localStorage.removeItem(STORAGE_KEY);
  clearSession();
  window.dispatchEvent(new CustomEvent("stellarmarket:walletDisconnected"));
}, [clearSession]);
```

#### Session Management

**Session Storage Format:**

```typescript
interface WalletSession {
  address: string; // Connected wallet address
  connectedAt: number; // Timestamp of connection
  lastActivityAt: number; // Timestamp of last activity
}
```

**Session Timeout Logic:**

```
Activity Detected
    ↓
Update lastActivityAt timestamp
    ↓
Clear existing timeouts
    ↓
Set warning timeout (25 minutes)
    ↓
Set expiry timeout (30 minutes)
    ↓
Dispatch warning event at 25 minutes
    ↓
Auto-disconnect at 30 minutes
```

**Session Restoration:**

```
App Mount
    ↓
Check localStorage for STORAGE_KEY
    ↓
Retrieve stored session
    ↓
Verify session age < 30 minutes
    ↓
Check Freighter installed
    ↓
Get current address
    ↓
Restore session if valid
```

#### Activity Tracking

**Activities that Extend Session:**

- Wallet connection
- Account switching
- Transaction signing
- Balance refresh
- Manual session extension

**Implementation:**

```typescript
const updateSessionActivity = useCallback(() => {
  const session = getStoredSession();
  if (session) {
    session.lastActivityAt = Date.now();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setSessionExpiresIn(SESSION_TIMEOUT_MS);

    // Clear and reset timeouts
    if (sessionTimeoutId.current) clearTimeout(sessionTimeoutId.current);
    if (sessionWarningId.current) clearTimeout(sessionWarningId.current);

    // Set new timeouts
    sessionWarningId.current = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("stellarmarket:sessionWarning", {
          detail: { expiresIn: SESSION_WARNING_MS },
        }),
      );
    }, SESSION_TIMEOUT_MS - SESSION_WARNING_MS);

    sessionTimeoutId.current = setTimeout(() => {
      disconnect();
      window.dispatchEvent(new CustomEvent("stellarmarket:sessionExpired"));
    }, SESSION_TIMEOUT_MS);
  }
}, [getStoredSession, disconnect]);
```

### Security Considerations

1. **Session Timeout**: 30 minutes prevents unauthorized access if device is left unattended
2. **Activity Tracking**: Only legitimate user actions extend session
3. **Secure Storage**: Session data stored in localStorage (not sensitive data)
4. **Event-Driven**: Components can react to session events
5. **Automatic Cleanup**: All timeouts and intervals cleared on disconnect
6. **Wallet Verification**: Connection re-verified on tab visibility change

### Error Handling

**Graceful Degradation:**

- If Freighter is not installed → Show "NOT_INSTALLED" error
- If wallet is locked → Show "LOCKED" error
- If connection fails → Show descriptive error message
- If session expires → Auto-disconnect with event notification

---

## Integration Checklist

### Frontend

- [x] Enhanced WalletContext with session management
- [x] Session timeout (30 minutes)
- [x] Session warning (5 minutes before expiry)
- [x] Automatic session extension on activity
- [x] Wallet disconnect with cleanup
- [x] Event listeners for account changes
- [x] Event listeners for wallet disconnection
- [x] Visibility change handling

### Backend

- [x] Dispute notifications on creation
- [x] Dispute notifications on vote cast
- [x] Dispute notifications on resolution
- [x] Email template for dispute opened
- [x] Email template for dispute resolved
- [x] Notification service integration
- [x] Email service integration
- [x] Metadata passing for outcomes

### Database

- [x] NotificationType enum includes DISPUTE_RESOLVED
- [x] NotificationPreference supports dispute emails
- [x] Dispute model includes outcome field

---

## Testing Guide

### Manual Testing

**Wallet Connection:**

1. Install Freighter extension
2. Click "Connect Wallet"
3. Verify address displays
4. Verify balance loads
5. Verify session is active

**Session Management:**

1. Connect wallet
2. Wait 25 minutes → Verify warning event
3. Click "Extend Session" → Verify timeout resets
4. Wait 30 minutes without activity → Verify auto-disconnect
5. Verify session data cleared from localStorage

**Wallet Disconnect:**

1. Connect wallet
2. Click "Disconnect" → Verify state cleared
3. Lock Freighter → Verify auto-disconnect
4. Remove Freighter extension → Verify auto-disconnect
5. Switch accounts → Verify session updated

**Dispute Notifications:**

1. Create dispute → Verify in-app notification
2. Check email → Verify dispute opened email
3. Cast vote → Verify vote notification
4. Resolve dispute → Verify resolution notification
5. Check email → Verify dispute resolved email

### Automated Testing

```typescript
// Example test
describe("WalletContext", () => {
  it("should extend session on activity", async () => {
    const { result } = renderHook(() => useWallet());

    act(() => {
      result.current.connect();
    });

    const initialExpiry = result.current.sessionExpiresIn;

    act(() => {
      result.current.extendSession();
    });

    expect(result.current.sessionExpiresIn).toBe(SESSION_TIMEOUT_MS);
  });

  it("should auto-disconnect after timeout", async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useWallet());

    act(() => {
      result.current.connect();
    });

    expect(result.current.address).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(SESSION_TIMEOUT_MS + 1000);
    });

    expect(result.current.address).toBeNull();
    jest.useRealTimers();
  });
});
```

---

## Configuration

### Environment Variables

No new environment variables required. Uses existing:

- `NEXT_PUBLIC_API_URL` - Backend API URL
- `NEXT_PUBLIC_FRONTEND_URL` - Frontend URL (for email links)

### Constants

**Frontend (`WalletContext.tsx`):**

```typescript
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_WARNING_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = "stellarmarket_wallet_connected";
const SESSION_KEY = "stellarmarket_wallet_session";
```

**Backend:**

- Uses existing notification batching (5 seconds, max 10)
- Dispute notifications bypass batching (urgent)

---

## Troubleshooting

### Session Not Persisting

- Check localStorage is enabled
- Verify SESSION_KEY is being set
- Check browser console for errors

### Notifications Not Sending

- Verify NotificationPreference exists for user
- Check email configuration in backend
- Verify Socket.IO connection is active
- Check notification service logs

### Wallet Not Disconnecting

- Verify Freighter extension is responding
- Check browser console for errors
- Try manual disconnect button
- Clear localStorage and refresh

---

## Future Enhancements

1. **Multi-wallet Support**: Add support for other Stellar wallets
2. **Session Persistence**: Option to remember session across browser restarts
3. **Biometric Authentication**: Add fingerprint/face recognition for session extension
4. **Notification Preferences UI**: Allow users to customize notification settings
5. **Dispute Analytics**: Track dispute resolution times and outcomes
6. **Webhook Support**: Send dispute notifications to external systems

---

## References

- [Freighter API Documentation](https://github.com/stellar/freighter-api)
- [Stellar SDK Documentation](https://developers.stellar.org/docs)
- [Socket.IO Documentation](https://socket.io/docs/)
- [Prisma Documentation](https://www.prisma.io/docs/)
