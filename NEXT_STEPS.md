# Stability Improvements - Next Steps

## Completed ✅

1. **WebSocket Event Listener Memory Leaks** - Fixed
   - Empty handler Sets are now cleaned up
   - Max handler limit with warnings
   - Reconnection timer deduplication
   - Connection timeout (10s)
   - Proper CONNECTING socket cleanup

2. **Audio Resource Leaks** - Fixed
   - Centralized cleanup with error handling
   - AudioContext.close() properly awaited
   - MediaStream tracks safely stopped
   - Try-finally for guaranteed cleanup
   - Safe unmount handling

3. **WebSocket Connection Stability** - Fixed
   - State machine improvements
   - Connection timeout protection
   - Proper event listener removal
   - Clean state on reconnect

## High Priority - Implement Next

### 1. Promise Rejection Handlers

**Problem:** Unhandled promise rejections cause silent failures

**Solution:**
```typescript
// Add global handler in app root
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[UnhandledRejection]', event.reason);
    // Send to telemetry
    // Show user-friendly error toast
  });
}

// Wrap critical async operations
try {
  await someAsyncOperation();
} catch (error) {
  toast.error('Operation failed. Please try again.');
  // Log to telemetry
}
```

**Files to Update:**
- `packages/web/src/app/layout.tsx` - Add global handler
- `packages/web/src/app/chat/[sessionId]/hooks/use-chat-session.ts` - Wrap async calls
- `packages/web/src/hooks/use-voice-recording.ts` - Already improved
- `packages/web/src/hooks/use-voice-call.ts` - Already improved

**Estimated Effort:** 2-3 hours

---

### 2. Race Condition Protection

**Problem:** Concurrent state updates can cause duplicate messages

**Current Issue in use-chat-session.ts:**
```typescript
const unsubEnd = ws.onAgentMessageEnd((content, ..., turnId) => {
  // No deduplication check!
  setMessages((prev) => [...prev, { id: messageId, content, ... }]);
});
```

**Solution:**
```typescript
// Use Map for message deduplication
const [messageMap, setMessageMap] = useState<Map<string, Message>>(new Map());

const unsubEnd = ws.onAgentMessageEnd((content, ..., turnId) => {
  const messageId = turnId ? `${turnId}-agent` : crypto.randomUUID();

  setMessageMap((prev) => {
    const next = new Map(prev);
    // Only add if not already present
    if (!next.has(messageId)) {
      next.set(messageId, { id: messageId, content, ... });
    }
    return next;
  });
});

// Derive messages array from map
const messages = useMemo(() =>
  Array.from(messageMap.values()).sort((a, b) =>
    a.timestamp.getTime() - b.timestamp.getTime()
  ),
  [messageMap]
);
```

**Alternative:** Use Set to track seen IDs
```typescript
const seenMessageIds = useRef<Set<string>>(new Set());

const unsubEnd = ws.onAgentMessageEnd((content, ..., turnId) => {
  const messageId = turnId ? `${turnId}-agent` : crypto.randomUUID();

  if (seenMessageIds.current.has(messageId)) {
    console.warn('[Chat] Duplicate message ignored:', messageId);
    return;
  }

  seenMessageIds.current.add(messageId);
  setMessages((prev) => [...prev, { id: messageId, content, ... }]);
});
```

**Files to Update:**
- `packages/web/src/app/chat/[sessionId]/hooks/use-chat-session.ts` - Main target

**Estimated Effort:** 3-4 hours

---

### 3. Hook Dependency Optimization

**Problem:** useEffect dependencies cause unnecessary reconnections

**Current Issue:**
```typescript
useEffect(() => {
  // ... setup WebSocket handlers
  return () => {
    // ... cleanup 16+ handlers
    ws.disconnect();
  };
}, [sessionId, authLoading, isAuthenticated, isDemo, demoFingerprint, onLimitReached]);
//                                                                     ^^^^^^^^^^^^^^
//                                                                     Changes every render!
```

**Solution:**
```typescript
// Stabilize callback with useCallback
const onLimitReachedStable = useCallback(() => {
  onLimitReached?.();
}, [onLimitReached]);

// Or use ref for callbacks that don't need to trigger re-setup
const onLimitReachedRef = useRef(onLimitReached);
useEffect(() => {
  onLimitReachedRef.current = onLimitReached;
}, [onLimitReached]);

useEffect(() => {
  // ... use onLimitReachedRef.current in handlers
}, [sessionId, authLoading, isAuthenticated, isDemo, demoFingerprint]);
//  ^^^^^ onLimitReached removed from deps
```

**Files to Update:**
- `packages/web/src/app/chat/[sessionId]/hooks/use-chat-session.ts` - Lines 520-820

**Estimated Effort:** 2 hours

---

## Medium Priority

### 4. Error Boundaries

**Add React error boundaries around:**
- Audio initialization components
- WebSocket connection UI
- Chat message rendering

**Example:**
```typescript
class AudioErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Audio error:', error, errorInfo);
    // Send to telemetry
  }

  render() {
    if (this.state.hasError) {
      return <AudioErrorFallback />;
    }
    return this.props.children;
  }
}
```

**Estimated Effort:** 3-4 hours

---

### 5. State Batching with startTransition

**Use React 19's startTransition for non-urgent updates:**
```typescript
import { startTransition } from 'react';

const unsubAgent = ws.onAgentMessage((content) => {
  // Urgent: Stop loading immediately
  setIsLoading(false);

  // Non-urgent: Batch these updates
  startTransition(() => {
    setStreamingContent('');
    setMessages((prev) => [...prev, newMessage]);
    setCurrentEmotionalState(emotionalState);
    setImageGenTrigger((prev) => prev + 1);
  });
});
```

**Files to Update:**
- `packages/web/src/app/chat/[sessionId]/hooks/use-chat-session.ts` - Message handlers

**Estimated Effort:** 1-2 hours

---

## Low Priority / Future Improvements

### 6. Telemetry & Monitoring

**Add metrics for:**
```typescript
// Memory tracking
const memoryMetrics = {
  eventHandlerCount: ws.handlers.size,
  audioContextCount: audioContexts.size,
  messageCount: messages.length,
};

// Error tracking
window.addEventListener('unhandledrejection', (event) => {
  sendToTelemetry({
    type: 'unhandled_rejection',
    error: event.reason,
    timestamp: Date.now(),
  });
});

// Connection metrics
const connectionMetrics = {
  reconnectionRate: reconnectCount / sessionDuration,
  averageLatency: totalLatency / messageCount,
  disconnectCount: disconnectEvents.length,
};
```

**Tools to integrate:**
- Sentry for error tracking
- DataDog for performance monitoring
- Custom metrics endpoint for business logic

**Estimated Effort:** 8-12 hours

---

### 7. Connection State Machine

**Formalize WebSocket states:**
```typescript
type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

// Explicit state transitions
function transitionTo(newState: ConnectionState) {
  const validTransitions = {
    'disconnected': ['connecting'],
    'connecting': ['connected', 'failed'],
    'connected': ['disconnected', 'reconnecting'],
    'reconnecting': ['connected', 'failed'],
    'failed': ['disconnected'],
  };

  if (validTransitions[connectionState].includes(newState)) {
    setConnectionState(newState);
  } else {
    console.warn(`Invalid state transition: ${connectionState} -> ${newState}`);
  }
}
```

**Estimated Effort:** 4-6 hours

---

## Testing Requirements

For each new fix, add:

1. **Unit Tests**
   - Test success path
   - Test error handling
   - Test resource cleanup
   - Test edge cases

2. **Integration Tests**
   - Test component integration
   - Test state synchronization
   - Test error propagation

3. **E2E Tests**
   - Test full user workflows
   - Test network interruptions
   - Test long-running sessions

**Estimated Effort:** 2 hours per fix

---

## Priority Order

**Week 1:**
1. Promise rejection handlers (2-3h)
2. Race condition protection (3-4h)
3. Hook dependency optimization (2h)

**Week 2:**
4. Error boundaries (3-4h)
5. State batching with startTransition (1-2h)
6. Integration testing (4h)

**Week 3:**
7. Telemetry & monitoring (8-12h)
8. Connection state machine (4-6h)

---

## Success Metrics

Track these metrics before/after each fix:

1. **Memory Growth Rate**
   - Target: <5MB/hour
   - Current: <5MB/hour (after current fixes)

2. **Unhandled Rejection Rate**
   - Target: <1 per minute
   - Current: Unknown (add tracking)

3. **Message Duplication Rate**
   - Target: 0%
   - Current: Unknown (add tracking)

4. **Connection Stability**
   - Target: >99% uptime for 1-hour sessions
   - Current: Improved with timeout fix

5. **Error Recovery Rate**
   - Target: >95% of errors handled gracefully
   - Current: Unknown (add tracking)

---

## Resources Needed

- 1 developer week for high priority items
- 1 additional developer week for medium priority items
- Access to production metrics/logs for monitoring
- Staging environment for testing

---

## Questions to Answer

1. What error tracking system are we using? (Sentry, LogRocket, etc.)
2. What are acceptable error rates for production?
3. Should we add feature flags for gradual rollout?
4. Do we have A/B testing infrastructure for measuring impact?
5. What's the process for emergency rollback?

---

## Notes

- All high-priority fixes are non-breaking changes
- Can be deployed incrementally
- Tests should be added before each deployment
- Monitor error rates closely after each deploy
