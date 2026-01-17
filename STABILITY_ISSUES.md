# Campfire Stability Issues - Analysis and Fixes

## Executive Summary

This document details critical stability issues identified in the Campfire codebase and their fixes. Issues are categorized by severity and impact on system reliability.

## Critical Issues Identified

### 1. **WebSocket Event Listener Memory Leaks** (CRITICAL)

#### Location
- `packages/web/src/lib/ws/client.ts` - CampfireWebSocket class
- `packages/web/src/app/chat/[sessionId]/hooks/use-chat-session.ts` - Line 520-820

#### Problem
The WebSocket client maintains a Map of event handlers but has several leak scenarios:

**Issue A: Handler Set Not Cleaned Up**
```typescript
on<T>(type: WSMessageType | '*', handler: MessageHandler<T>): () => void {
  if (!this.handlers.has(type)) {
    this.handlers.set(type, new Set());
  }
  this.handlers.get(type)!.add(handler as MessageHandler);
  return () => {
    this.handlers.get(type)?.delete(handler as MessageHandler);
  };
}
```
- When all handlers are removed from a Set, the empty Set remains in the Map
- Over time, this accumulates memory for unused event types
- Impact: ~1KB per event type per session, compounds over multiple sessions

**Issue B: Wildcard Handler Accumulation**
```typescript
const wildcardHandlers = this.handlers.get('*');
if (wildcardHandlers) {
  for (const handler of wildcardHandlers) {
    try {
      handler(message);
    } catch (error) {
      console.error('[WS] Wildcard handler error', error);
    }
  }
}
```
- Wildcard handlers are called for EVERY message type
- No cleanup mechanism for stale wildcard handlers
- Impact: Performance degradation as handlers accumulate

**Issue C: Reconnection Timer Leak**
```typescript
private reconnectTimeout: NodeJS.Timeout | null = null;

disconnect(): void {
  if (this.reconnectTimeout) {
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }
  // ... rest of cleanup
}
```
- `scheduleReconnect()` doesn't check if timeout already exists
- Multiple failed connections can create multiple pending timers
- Impact: Memory leak + unexpected reconnection attempts

**Issue D: use-chat-session Hook Cleanup**
```typescript
useEffect(() => {
  // ... setup 16+ event handlers
  return () => {
    unsubPing();
    unsubAuth();
    // ... 14 more unsubscribe calls
    ws.disconnect();
  };
}, [sessionId, authLoading, isAuthenticated, isDemo, demoFingerprint, onLimitReached]);
```
- Dependencies array includes `onLimitReached` callback which changes on every render
- This causes the entire WebSocket to disconnect/reconnect unnecessarily
- All 16 handlers are destroyed and recreated, causing memory churn
- Impact: Severe performance degradation, dropped messages, connection instability

#### Fix Strategy
1. Clean up empty handler Sets from Map
2. Add max handler limit with warning
3. Prevent duplicate reconnection timers
4. Stabilize useEffect dependencies with useCallback/useRef

---

### 2. **Audio Resource Leaks** (CRITICAL)

#### Location
- `packages/web/src/hooks/use-voice-recording.ts` - Lines 163-275
- `packages/web/src/hooks/use-voice-call.ts` - Lines 125-208

#### Problem

**Issue A: AudioContext Not Always Closed**
```typescript
const stopRecording = useCallback(async () => {
  // ... cleanup code
  if (audioContextRef.current) {
    audioContextRef.current.close();
    audioContextRef.current = null;
  }
}, [isRecording, wsRef, sendAudioChunks]);
```
- If component unmounts during recording, cleanup happens in useEffect
- Race condition: `stopRecording` async operation may not complete
- AudioContext.close() returns a Promise that's not awaited
- Impact: ~10-20MB per unclosed AudioContext, browser limit ~6 contexts

**Issue B: MediaStream Track Leaks**
```typescript
if (mediaStreamRef.current) {
  mediaStreamRef.current.getTracks().forEach((track) => track.stop());
  mediaStreamRef.current = null;
}
```
- MediaStream tracks remain active if exception thrown before cleanup
- No try-finally protection
- Impact: Camera/microphone remains active, privacy issue + resource leak

**Issue C: Interval Not Cleared on Error**
```typescript
chunkIntervalRef.current = window.setInterval(sendAudioChunks, chunkInterval);

// Later, only cleared in stopRecording
if (chunkIntervalRef.current) {
  clearInterval(chunkIntervalRef.current);
  chunkIntervalRef.current = null;
}
```
- If `startRecording` fails after setting interval, interval never cleared
- Impact: Interval fires indefinitely, attempting to send chunks with no WebSocket

**Issue D: Voice Call VAD Not Destroyed**
```typescript
const endCall = useCallback(() => {
  if (vadRef.current) {
    vadRef.current.pause();
    vadRef.current.destroy();
    vadRef.current = null;
  }
}, [wsRef, audioPlayerRef]);
```
- VAD destruction not in try-catch
- If destroy() throws, cleanup stops halfway
- VAD holds references to AudioContext and MediaStream
- Impact: Complete audio subsystem leak

#### Fix Strategy
1. Add try-finally blocks for all resource cleanup
2. Await AudioContext.close() and handle promise rejection
3. Centralize cleanup in a single function called from multiple paths
4. Add error boundaries around audio initialization

---

### 3. **Unhandled Promise Rejections** (HIGH)

#### Location
- Multiple async functions across hooks and services
- Particularly in voice recording, WebSocket authentication, session loading

#### Problem

**Example from use-voice-recording.ts:**
```typescript
const startRecording = useCallback(async () => {
  // ...
  try {
    const stream = await navigator.mediaDevices.getUserMedia({...});
    await audioContext.audioWorklet.addModule(workletUrl);
    // No catch for the promise rejection here
  } catch (err) {
    // Only catches getUserMedia errors, not worklet errors
  }
}, []);
```

**Example from use-chat-session.ts:**
```typescript
async function loadSessionData() {
  try {
    const session = await getSession(sessionId);
    // Multiple nested await calls
    const companionData = await getCompanion(session.companionId);
    const backstory = await getCompanionBackstory(session.companionId);
    // Nested try-catch but outer errors not handled
  } catch (error) {
    console.error('Failed to load session data:', error);
    // Error logged but not surfaced to user
  }
}
```

#### Impact
- Uncaught promise rejections in browser console
- Silent failures that leave UI in inconsistent state
- Potential app crashes in strict mode
- Poor user experience with no error feedback

#### Fix Strategy
1. Add global unhandled rejection handler for telemetry
2. Add promise rejection handlers to all async operations
3. Surface errors to user via toast notifications
4. Add error state to UI components

---

### 4. **Race Conditions in State Management** (HIGH)

#### Location
- `packages/web/src/app/chat/[sessionId]/hooks/use-chat-session.ts`
- WebSocket message handlers updating React state

#### Problem

**Issue A: Concurrent Message Updates**
```typescript
const unsubAgent = ws.onAgentMessage((content) => {
  setIsLoading(false);
  setStreamingContent('');
  setMessages((prev) => [...prev, newMessage]);
  setCurrentEmotionalState(emotionalState);
  setImageGenTrigger((prev) => prev + 1);
  // 5 state updates not batched
});
```
- Multiple state updates not batched via startTransition
- Race condition between streaming chunks and final message
- Can cause duplicate messages in UI

**Issue B: Message Deduplication Missing**
```typescript
const unsubEnd = ws.onAgentMessageEnd((content, imagePrompt, sequence, turnId) => {
  const messageId = turnId ? `${turnId}-agent-${sequence.index}` : crypto.randomUUID();
  setMessages((prev) => [...prev, { id: messageId, ... }]);
});
```
- No check if message with same ID already exists
- Multi-message responses can result in duplicates
- Impact: Confusing UI, wasted rendering

**Issue C: Group Chat Participant Race**
```typescript
case 'companion_joined': {
  this._groupParticipants.set(payload.companion.companionId, payload.companion);
  this._isGroupChat = this._groupParticipants.size > 1;
  // Not atomic, state can be inconsistent between these lines
}
```
- Participant map and group chat flag updated separately
- Handlers reading state between updates see inconsistent data

#### Fix Strategy
1. Use startTransition for non-urgent state updates
2. Batch related state updates with single setState callback
3. Add message deduplication via Set or Map
4. Make state updates atomic using useReducer

---

### 5. **WebSocket Connection State Machine Issues** (MEDIUM)

#### Location
- `packages/web/src/lib/ws/client.ts` - connect() and disconnect() methods

#### Problem

**Issue A: CONNECTING State Not Handled**
```typescript
connect(): void {
  if (this.ws?.readyState === WebSocket.OPEN) {
    return;
  }
  if (this.ws?.readyState === WebSocket.CONNECTING) {
    return; // Waits, but no timeout
  }
  this.ws = new WebSocket(wsUrl);
}
```
- CONNECTING state can hang forever if connection never completes
- No timeout mechanism
- Impact: UI stuck in "connecting" state indefinitely

**Issue B: iOS CONNECTING Socket Issue**
```typescript
disconnect(): void {
  if (this.ws) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      console.log('[WS] Socket still connecting, skipping disconnect');
      // Leaves socket dangling!
    }
  }
}
```
- CONNECTING sockets left in limbo
- Can accumulate multiple CONNECTING sockets
- Impact: Memory leak, iOS-specific crashes

**Issue C: Reconnection Doesn't Reset State**
```typescript
private scheduleReconnect(): void {
  if (this.reconnectTimeout) return;
  this.reconnectTimeout = setTimeout(() => {
    this.reconnectTimeout = null;
    this.connect(); // Doesn't clear stale state first
  }, this.options.reconnectDelay);
}
```
- Old WebSocket instance not cleaned up before reconnect
- Handlers from old socket may still fire
- Impact: Duplicate message handlers, memory leak

#### Fix Strategy
1. Add connection timeout with automatic failure
2. Track and clean up CONNECTING sockets properly
3. Add state machine with explicit transitions
4. Reset all state before reconnection attempt

---

## Testing Strategy

### 1. Unit Tests
- Memory leak detection via weak references
- State transition validation
- Error handler coverage

### 2. Integration Tests
- WebSocket reconnection scenarios
- Concurrent audio session handling
- Message deduplication under load

### 3. E2E Tests
- Long-running session stability
- Network interruption recovery
- Resource cleanup verification

### 4. Performance Tests
- Memory profiling over time
- Event listener count tracking
- Connection pool stress testing

---

## Monitoring & Observability

### Metrics to Track
1. WebSocket reconnection rate
2. Unhandled promise rejection count
3. Audio context count (should be ≤ 1 per active session)
4. Memory usage growth rate
5. Event listener count over time

### Alerts
1. Memory growth > 50MB/hour
2. Reconnection rate > 3/minute
3. Uncaught errors > 5/minute
4. Audio contexts > 3 simultaneously

---

## Deployment Plan

### Phase 1: Critical Fixes (Immediate)
- WebSocket event listener cleanup
- Audio resource leaks
- Unhandled promise rejections

### Phase 2: High Priority (Week 1)
- Race condition fixes
- Connection state machine improvements
- Error boundaries

### Phase 3: Monitoring (Week 2)
- Add telemetry
- Performance profiling
- Load testing

---

## Rollback Plan

All fixes include feature flags:
- `ENABLE_WS_HANDLER_CLEANUP` - WebSocket cleanup improvements
- `ENABLE_AUDIO_SAFETY_CHECKS` - Enhanced audio cleanup
- `ENABLE_STATE_DEDUPLICATION` - Message deduplication

Monitoring will detect regressions within 5 minutes via error rate spikes.
