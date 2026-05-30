# Quick Start Guide: Wallet, Disputes & Session Management

## What Was Implemented

### 1. Enhanced Freighter Wallet Connection ✅

- **Session Management**: 30-minute timeout with 5-minute warning
- **Auto-disconnect**: On wallet lock, extension removal, or timeout
- **Session Persistence**: Survives page refresh (if not expired)
- **Activity Tracking**: Session extends on user actions

### 2. Dispute Status Notifications ✅

- **In-app Notifications**: Real-time via Socket.IO
- **Email Notifications**: Sent on dispute opened/resolved
- **Vote Notifications**: Notifies parties when votes are cast
- **Batching**: Urgent notifications bypass batching

### 3. Wallet Disconnect & Session Management ✅

- **Secure Logout**: Clears all session data
- **Automatic Expiry**: 30 minutes of inactivity
- **Event System**: Components can listen for session events
- **Graceful Degradation**: Handles wallet errors gracefully

---

## Quick Integration

### Frontend: Using Wallet Context

```typescript
import { useWallet } from "@/context/WalletContext";

export function MyComponent() {
  const {
    address,           // Connected wallet address
    connect,           // Connect wallet function
    disconnect,        // Disconnect wallet function
    isSessionActive,   // Is session currently active
    sessionExpiresIn,  // Milliseconds until expiry
    extendSession,     // Extend session function
    balance,           // XLM balance
    balances,          // All token balances
    signAndBroadcastTransaction  // Sign & broadcast tx
  } = useWallet();

  return (
    <div>
      {address ? (
        <>
          <p>Connected: {address}</p>
          <p>Balance: {balance} XLM</p>
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

### Frontend: Listening to Session Events

```typescript
useEffect(() => {
  // Session warning (5 minutes before expiry)
  const handleWarning = (e: Event) => {
    const { expiresIn } = (e as CustomEvent).detail;
    console.log(`Session expires in ${expiresIn}ms`);
    // Show warning modal
  };

  // Session expired
  const handleExpired = () => {
    console.log("Session expired - user disconnected");
    // Show expiry message
  };

  // Wallet disconnected
  const handleDisconnected = () => {
    console.log("Wallet disconnected");
    // Update UI
  };

  window.addEventListener("stellarmarket:sessionWarning", handleWarning);
  window.addEventListener("stellarmarket:sessionExpired", handleExpired);
  window.addEventListener(
    "stellarmarket:walletDisconnected",
    handleDisconnected,
  );

  return () => {
    window.removeEventListener("stellarmarket:sessionWarning", handleWarning);
    window.removeEventListener("stellarmarket:sessionExpired", handleExpired);
    window.removeEventListener(
      "stellarmarket:walletDisconnected",
      handleDisconnected,
    );
  };
}, []);
```

### Frontend: Listening to Dispute Notifications

```typescript
import { useSocket } from "@/context/SocketContext";

export function DisputeNotificationListener() {
  const { socket } = useSocket();

  useEffect(() => {
    socket?.on("notification:new", (notification) => {
      if (notification.type === "DISPUTE_RAISED") {
        console.log("Dispute raised:", notification.message);
        // Show notification UI
      } else if (notification.type === "DISPUTE_RESOLVED") {
        console.log("Dispute resolved:", notification.message);
        // Show notification UI
      }
    });

    return () => {
      socket?.off("notification:new");
    };
  }, [socket]);

  return null;
}
```

### Backend: Dispute Service Already Integrated

The dispute service automatically sends notifications:

```typescript
// Creating a dispute automatically sends notifications
const dispute = await DisputeService.createDispute(jobId, initiatorId, reason);
// ✅ Notifications sent to client and freelancer
// ✅ Emails sent if preferences enabled

// Casting a vote automatically sends notifications
const vote = await DisputeService.castVote(disputeId, voterId, choice, reason);
// ✅ Notifications sent to both parties

// Resolving a dispute automatically sends notifications
const resolved = await DisputeService.resolveDispute(disputeId, outcome);
// ✅ Notifications sent with outcome details
// ✅ Emails sent with resolution info
```

---

## Key Features

### Session Management

| Feature          | Details                                |
| ---------------- | -------------------------------------- |
| **Timeout**      | 30 minutes of inactivity               |
| **Warning**      | 5 minutes before expiry                |
| **Extension**    | Call `extendSession()` to reset timer  |
| **Persistence**  | Survives page refresh (if not expired) |
| **Auto-cleanup** | All timeouts cleared on disconnect     |

### Dispute Notifications

| Event                | Recipients         | Type             | Email |
| -------------------- | ------------------ | ---------------- | ----- |
| **Dispute Raised**   | Client, Freelancer | DISPUTE_RAISED   | ✅    |
| **Vote Cast**        | Client, Freelancer | DISPUTE_RAISED   | ❌    |
| **Dispute Resolved** | Client, Freelancer | DISPUTE_RESOLVED | ✅    |

### Wallet Disconnect

| Trigger                    | Behavior                     |
| -------------------------- | ---------------------------- |
| **User clicks disconnect** | Immediate disconnect         |
| **Wallet locked**          | Auto-detect and disconnect   |
| **Extension removed**      | Auto-detect and disconnect   |
| **Account revoked**        | Auto-detect and disconnect   |
| **Session timeout**        | Auto-disconnect after 30 min |

---

## Testing Checklist

### Wallet Connection

- [ ] Connect wallet → Address displays
- [ ] Balance loads → Shows XLM balance
- [ ] Session active → `isSessionActive` is true
- [ ] Refresh page → Session restored (if < 30 min)

### Session Management

- [ ] Wait 25 minutes → Warning event fires
- [ ] Click extend → Timer resets
- [ ] Wait 30 minutes → Auto-disconnect
- [ ] Verify localStorage cleared

### Wallet Disconnect

- [ ] Click disconnect → State cleared
- [ ] Lock wallet → Auto-disconnect
- [ ] Remove extension → Auto-disconnect
- [ ] Switch accounts → Session updated

### Dispute Notifications

- [ ] Create dispute → In-app notification appears
- [ ] Check email → Dispute opened email received
- [ ] Cast vote → Vote notification appears
- [ ] Resolve dispute → Resolution notification appears
- [ ] Check email → Dispute resolved email received

---

## File Changes Summary

### Frontend

- **Modified**: `frontend/src/context/WalletContext.tsx`
  - Added session management
  - Added session timeout/warning
  - Enhanced disconnect handling
  - Added event dispatching

### Backend

- **Modified**: `backend/src/services/dispute.service.ts`
  - Added notification on dispute creation
  - Added notification on vote cast
  - Added notification on dispute resolution
- **Modified**: `backend/src/services/notification.service.ts`
  - Added DISPUTE_RESOLVED email support
  - Added outcome metadata handling
- **Modified**: `backend/src/services/email.service.ts`
  - Added dispute.resolved event type
  - Added outcome parameter support
- **Created**: `backend/src/templates/email/dispute-resolved.ts`
  - New email template for dispute resolution

### Documentation

- **Created**: `WALLET_DISPUTE_SESSION_IMPLEMENTATION.md`
  - Comprehensive implementation guide
  - Usage examples
  - Testing guide
  - Troubleshooting

---

## Environment Setup

No new environment variables needed. Uses existing:

- `NEXT_PUBLIC_API_URL` - Backend API
- `NEXT_PUBLIC_FRONTEND_URL` - Frontend URL (for email links)

### Constants (Already Set)

```typescript
// Frontend
SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
SESSION_WARNING_MS = 5 * 60 * 1000; // 5 minutes

// Backend
BATCH_WINDOW_MS = 5000; // 5 seconds
MAX_BATCH_SIZE = 10; // notifications
```

---

## Common Issues & Solutions

### Issue: Session not persisting after refresh

**Solution**: Check if session age < 30 minutes. Sessions older than 30 minutes are cleared.

### Issue: Notifications not sending

**Solution**:

1. Verify user has NotificationPreference record
2. Check email configuration in backend
3. Verify Socket.IO connection is active
4. Check notification service logs

### Issue: Wallet not auto-disconnecting

**Solution**:

1. Verify Freighter extension is responding
2. Check browser console for errors
3. Try manual disconnect button
4. Clear localStorage and refresh

### Issue: Session warning not firing

**Solution**:

1. Verify 25 minutes have passed since connection
2. Check browser console for event listener errors
3. Verify window event listeners are attached

---

## Next Steps

1. **Test wallet connection** in development
2. **Test dispute notifications** with test accounts
3. **Monitor session timeouts** in production
4. **Gather user feedback** on session duration
5. **Consider adjusting timeouts** based on usage patterns

---

## Support

For issues or questions:

1. Check `WALLET_DISPUTE_SESSION_IMPLEMENTATION.md` for detailed docs
2. Review test examples in implementation guide
3. Check browser console for error messages
4. Review backend logs for notification errors
