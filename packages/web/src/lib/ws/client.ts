/**
 * WebSocket Client
 * Real-time communication with the gateway.
 */

import { publicEnv } from '../../env/public';

// Dynamically determine WebSocket URL based on environment
// - Explicit NEXT_PUBLIC_WS_URL takes priority
// - NEXT_PUBLIC_GATEWAY_URL is converted to WebSocket URL
// - Localhost: connect directly to gateway on port 3002
// - External (ngrok/prod): use same host with /ws path (proxied)
function getWebSocketUrl(): string {
  // Explicit WebSocket URL takes priority
  if (publicEnv.NEXT_PUBLIC_WS_URL) {
    return publicEnv.NEXT_PUBLIC_WS_URL;
  }

  // If gateway URL is set, derive WebSocket URL from it
  if (publicEnv.NEXT_PUBLIC_GATEWAY_URL) {
    const gatewayUrl = publicEnv.NEXT_PUBLIC_GATEWAY_URL;
    // Convert http(s):// to ws(s)://
    return gatewayUrl.replace(/^http/, 'ws') + '/ws';
  }

  if (typeof window === 'undefined') {
    return 'ws://localhost:3002/ws';
  }

  const { protocol, hostname } = window.location;

  // If accessing via localhost, connect to gateway directly
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'ws://localhost:3002/ws';
  }

  // External access (ngrok, production): use same host with /ws path
  // This requires a proxy (nginx) to route /ws to the gateway
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/ws`;
}

export type WSMessageType =
  | 'ping'
  | 'pong'
  | 'auth'
  | 'auth_anonymous'
  | 'auth_success'
  | 'auth_error'
  | 'session_start'
  | 'session_started'
  | 'session_end'
  | 'session_ended'
  | 'user_message'
  | 'agent_message'
  | 'agent_message_chunk'
  | 'agent_message_end'
  | 'audio_chunk'
  | 'audio_end'
  | 'transcription'
  | 'voice_start'
  | 'voice_audio_chunk'
  | 'voice_end'
  | 'voice_transcription'
  | 'tts_audio_chunk'
  | 'tts_audio_end'
  | 'voice_enabled'
  // Voice call message types
  | 'voice_call_start'
  | 'voice_call_end'
  | 'voice_call_started'
  | 'voice_call_ended'
  | 'voice_call_interrupt'
  | 'voice_call_insufficient_tokens'
  | 'voice_call_balance_update'
  | 'webcam_enabled'
  | 'webcam_frame'
  | 'game_update'
  | 'start_game'
  | 'user_game_move'
  | 'resign_game'
  | 'like_message'
  | 'like_acknowledged'
  // Group chat message types
  | 'companion_invited'
  | 'companion_joined'
  | 'companion_left'
  | 'companion_message_start'
  | 'companion_message_chunk'
  | 'companion_message_end'
  | 'group_chat_state'
  | 'invite_companion'
  | 'dismiss_companion'
  // Demo/anonymous session types
  | 'limit_reached'
  | 'usage_update'
  | 'engagement_update'
  | 'error';

/**
 * Group chat participant info
 */
export interface GroupParticipant {
  companionId: string;
  companionName: string;
  avatarUrl: string | null;
  role: 'primary' | 'invited';
  themeColor: string;
  joinedAt: string;
}

/**
 * Group chat state
 */
export interface GroupChatState {
  isGroupChat: boolean;
  hostCompanionId: string;
  participants: GroupParticipant[];
}

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  id: string;
  timestamp: string;
  payload: T;
}

type MessageHandler<T = unknown> = (message: WSMessage<T>) => void;

interface CampfireWSOptions {
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Event) => void;
  autoReconnect?: boolean;
  reconnectDelay?: number;
}

export class CampfireWebSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<WSMessageType | '*', Set<MessageHandler>> = new Map();
  private options: CampfireWSOptions;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private _isConnected = false;
  private _isAuthenticated = false;
  private _sessionId: string | null = null;
  private _isGroupChat = false;
  private _groupParticipants: Map<string, GroupParticipant> = new Map();
  private _hasConnectedOnce = false;
  // Anonymous/demo session state
  private _isAnonymous = false;
  private _messagesUsed = 0;
  private _messageLimit = 0;
  private _engagementScore = 0;
  // Pending messages queue for retry on iOS keyboard race condition
  private pendingMessages: Array<{ content: string }> = [];
  // Constants for stability
  private readonly MAX_HANDLERS_PER_TYPE = 100;
  private readonly CONNECTION_TIMEOUT_MS = 10000;

  constructor(options: CampfireWSOptions = {}) {
    this.options = {
      autoReconnect: true,
      reconnectDelay: 3000,
      ...options,
    };
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get isGroupChat(): boolean {
    return this._isGroupChat;
  }

  get groupParticipants(): GroupParticipant[] {
    return Array.from(this._groupParticipants.values());
  }

  getParticipant(companionId: string): GroupParticipant | undefined {
    return this._groupParticipants.get(companionId);
  }

  get isAnonymous(): boolean {
    return this._isAnonymous;
  }

  get messagesUsed(): number {
    return this._messagesUsed;
  }

  get messageLimit(): number {
    return this._messageLimit;
  }

  get remainingMessages(): number {
    return Math.max(0, this._messageLimit - this._messagesUsed);
  }

  get engagementScore(): number {
    return this._engagementScore;
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    // Already connected - nothing to do
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected, skipping connect()');
      return;
    }

    // Already connecting - wait for it to complete instead of creating a new socket
    // This prevents the iOS "WebSocket is closed before connection established" error
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      console.log('[WS] Already connecting, waiting for existing connection');
      return;
    }

    // Clean up any stale connection state before creating new connection
    this.cleanupWebSocket();

    const wsUrl = getWebSocketUrl();
    console.log('[WS] Creating new WebSocket connection to', wsUrl);
    this.ws = new WebSocket(wsUrl);

    // Set connection timeout to prevent hanging in CONNECTING state
    this.connectionTimeout = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        console.warn('[WS] Connection timeout, closing stale socket');
        this.ws.close();
        this.connectionTimeout = null;
        // Will trigger onclose which handles reconnection
      }
    }, this.CONNECTION_TIMEOUT_MS);

    this.ws.onopen = () => {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this._isConnected = true;
      this._hasConnectedOnce = true;
      console.log('[WS] Connected');
      this.options.onOpen?.();
    };

    this.ws.onclose = (event) => {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this._isConnected = false;
      this._isAuthenticated = false;
      this._sessionId = null;
      console.log('[WS] Disconnected', event.code, event.reason);
      this.options.onClose?.(event);

      // Auto-reconnect only for abnormal closures
      if (this.options.autoReconnect && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      // Only log as error if we had a working connection before (genuine disconnect)
      // Initial connection failures are expected in dev when gateway isn't running
      if (this._hasConnectedOnce) {
        console.error('[WS] Connection error');
      }
      this.options.onError?.(error);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;
        this.handleMessage(message);
      } catch (error) {
        console.error('[WS] Failed to parse message', error);
      }
    };
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    // Clear all timers
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    // Clean up WebSocket
    this.cleanupWebSocket();

    // Reset all state
    this.resetState();
  }

  /**
   * Clean up WebSocket connection safely
   */
  private cleanupWebSocket(): void {
    if (!this.ws) return;

    try {
      // Remove event listeners to prevent memory leaks
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;

      // Close if OPEN, or force close if CONNECTING after timeout
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Client disconnect');
      } else if (this.ws.readyState === WebSocket.CONNECTING) {
        // For CONNECTING state, we used to leave it dangling
        // Now we force close it to prevent accumulation
        console.log('[WS] Force closing CONNECTING socket to prevent leak');
        this.ws.close();
      }
    } catch (error) {
      console.warn('[WS] Error during WebSocket cleanup:', error);
    } finally {
      this.ws = null;
    }
  }

  /**
   * Reset all internal state
   */
  private resetState(): void {
    this._isConnected = false;
    this._isAuthenticated = false;
    this._sessionId = null;
    this._isGroupChat = false;
    this._groupParticipants.clear();
    this._isAnonymous = false;
    this._messagesUsed = 0;
    this._messageLimit = 0;
    this._engagementScore = 0;
    this.pendingMessages = [];
  }

  /**
   * Send a message
   */
  send<T>(type: WSMessageType, payload: T): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[WS] Cannot send - not connected, readyState:', this.ws?.readyState);
      return;
    }

    const message: WSMessage<T> = {
      type,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      payload,
    };

    try {
      this.ws.send(JSON.stringify(message));
      console.log('[WS] Message sent:', type);
    } catch (error) {
      console.error('[WS] Send failed:', type, error);
    }
  }

  /**
   * Authenticate with a token
   */
  authenticate(token: string): void {
    this.send('auth', { token });
  }

  /**
   * Authenticate anonymously with a fingerprint (for demo sessions)
   */
  authenticateAnonymous(fingerprint: string): void {
    this._isAnonymous = true;
    this.send('auth_anonymous', { fingerprint });
  }

  /**
   * Start a new session with a companion
   */
  startSession(companionId: string): void {
    this.send('session_start', { companionId });
  }

  /**
   * Resume an existing session by ID
   */
  resumeSession(sessionId: string): void {
    this.send('session_start', { sessionId });
  }

  /**
   * End the current session
   */
  endSession(): void {
    this.send('session_end', {});
  }

  /**
   * Send a user message
   */
  sendMessage(content: string): void {
    this.send('user_message', { content });
  }

  /**
   * Send a user message with auto-retry for iOS keyboard race condition.
   * If WebSocket is not ready, queues the message and sends when connection is restored.
   */
  sendMessageWithRetry(content: string): void {
    const readyState = this.ws?.readyState;
    const readyStateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    console.log('[WS] sendMessageWithRetry called, readyState:', readyState, `(${readyStateNames[readyState ?? 3]})`);

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Socket OPEN, sending message immediately');
      this.sendMessage(content);
    } else {
      // Queue message for retry - iOS Chrome can have transient disconnection during keyboard dismiss
      console.log('[WS] Connection not ready, queuing message for retry. pendingMessages:', this.pendingMessages.length + 1);
      this.pendingMessages.push({ content });
      // Trigger reconnection if not already connecting
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        console.log('[WS] Socket CLOSED or null, triggering connect()');
        this.connect();
      } else {
        console.log('[WS] Socket exists but not OPEN/CLOSED (likely CONNECTING), waiting...');
      }
    }
  }

  /**
   * Flush any pending messages (called after session is started)
   */
  flushPendingMessages(): void {
    console.log('[WS] flushPendingMessages called, pending:', this.pendingMessages.length, 'readyState:', this.ws?.readyState);
    while (this.pendingMessages.length > 0) {
      const msg = this.pendingMessages.shift();
      if (msg && this.ws?.readyState === WebSocket.OPEN) {
        console.log('[WS] Sending queued message');
        this.sendMessage(msg.content);
      } else {
        console.warn('[WS] Cannot flush message - socket not open, readyState:', this.ws?.readyState);
      }
    }
  }

  /**
   * Send an audio chunk
   */
  sendAudioChunk(data: string, sequence: number): void {
    this.send('audio_chunk', { data, sequence });
  }

  /**
   * Signal end of audio input
   */
  endAudio(): void {
    this.send('audio_end', {});
  }

  /**
   * Enable voice mode for the current session
   */
  enableVoice(): void {
    this.send('voice_enabled', { enabled: true });
  }

  /**
   * Disable voice mode for the current session
   */
  disableVoice(): void {
    this.send('voice_enabled', { enabled: false });
  }

  /**
   * Signal start of voice recording
   */
  startVoice(): void {
    this.send('voice_start', {});
  }

  /**
   * Send a voice audio chunk (base64 encoded PCM)
   */
  sendVoiceChunk(data: string): void {
    this.send('voice_audio_chunk', { data });
  }

  /**
   * Signal end of voice recording
   */
  endVoice(): void {
    this.send('voice_end', {});
  }

  // ===========================================================================
  // Voice Call Methods
  // ===========================================================================

  /**
   * Start a voice call session
   */
  startVoiceCall(): void {
    this.send('voice_call_start', {});
  }

  /**
   * End a voice call session
   */
  endVoiceCall(): void {
    this.send('voice_call_end', {});
  }

  /**
   * Interrupt voice call (stop companion TTS when user speaks)
   */
  interruptVoiceCall(): void {
    this.send('voice_call_interrupt', {});
  }

  /**
   * Enable webcam mode for the current session
   */
  enableWebcam(): void {
    this.send('webcam_enabled', { enabled: true });
  }

  /**
   * Disable webcam mode for the current session
   */
  disableWebcam(): void {
    this.send('webcam_enabled', { enabled: false });
  }

  /**
   * Send a webcam frame (base64 encoded JPEG)
   */
  sendWebcamFrame(data: string, width: number, height: number): void {
    this.send('webcam_frame', { data, width, height, timestamp: Date.now() });
  }

  /**
   * Start a game with the companion
   */
  startGame(gameType: string): void {
    this.send('start_game', { gameType });
  }

  /**
   * Send a user game move
   */
  sendGameMove(move: string): void {
    this.send('user_game_move', { move });
  }

  /**
   * Resign from the current game
   */
  resignGame(): void {
    this.send('resign_game', {});
  }

  /**
   * Like a message (increment like count)
   */
  likeMessage(turnId: string): void {
    this.send('like_message', { turnId });
  }

  // ===========================================================================
  // Group Chat Methods
  // ===========================================================================

  /**
   * Invite a companion to the current session
   */
  inviteCompanion(friendCompanionId: string, reason?: string): void {
    this.send('invite_companion', { friendCompanionId, reason });
  }

  /**
   * Dismiss a companion from the current session
   */
  dismissCompanion(companionId: string): void {
    this.send('dismiss_companion', { companionId });
  }

  /**
   * Subscribe to a specific message type
   */
  on<T = unknown>(type: WSMessageType | '*', handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const handlerSet = this.handlers.get(type)!;

    // Prevent memory leaks from too many handlers
    if (handlerSet.size >= this.MAX_HANDLERS_PER_TYPE) {
      console.warn(
        `[WS] Too many event handlers for type "${type}" (${handlerSet.size}). ` +
        `This may indicate a memory leak. Check that handlers are properly unsubscribed.`
      );
    }

    handlerSet.add(handler as MessageHandler);

    // Return unsubscribe function
    return () => {
      const set = this.handlers.get(type);
      if (set) {
        set.delete(handler as MessageHandler);
        // Clean up empty sets to prevent memory accumulation
        if (set.size === 0) {
          this.handlers.delete(type);
        }
      }
    };
  }

  /**
   * Subscribe to agent message chunks (convenience method)
   */
  onAgentChunk(handler: (chunk: string) => void): () => void {
    return this.on<{ content: string }>('agent_message_chunk', (msg) => {
      handler(msg.payload.content);
    });
  }

  /**
   * Subscribe to complete agent messages
   */
  onAgentMessage(handler: (content: string, sessionId: string) => void): () => void {
    return this.on<{ content: string; sessionId: string }>('agent_message', (msg) => {
      handler(msg.payload.content, msg.payload.sessionId);
    });
  }

  /**
   * Message sequence info for multi-message responses
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  static readonly MessageSequence: {
    index: number;
    total: number;
    isLast: boolean;
    typingDelayMs?: number;
  } = {} as never;

  /**
   * Subscribe to agent message end (with optional sequence info for multi-message)
   */
  onAgentMessageEnd(
    handler: (
      content: string,
      imagePrompt?: string,
      shouldGenerateImage?: boolean,
      imageIntentConfidence?: number,
      sequence?: { index: number; total: number; isLast: boolean; typingDelayMs?: number },
      turnId?: string
    ) => void
  ): () => void {
    return this.on<{
      content: string;
      imagePrompt?: string;
      shouldGenerateImage?: boolean;
      imageIntentConfidence?: number;
      sequence?: { index: number; total: number; isLast: boolean; typingDelayMs?: number };
      turnId?: string;
    }>('agent_message_end', (msg) => {
      handler(
        msg.payload.content,
        msg.payload.imagePrompt,
        msg.payload.shouldGenerateImage,
        msg.payload.imageIntentConfidence,
        msg.payload.sequence,
        msg.payload.turnId
      );
    });
  }

  /**
   * Subscribe to errors
   */
  onError(handler: (message: string, code?: string) => void): () => void {
    return this.on<{ message: string; code?: string }>('error', (msg) => {
      handler(msg.payload.message, msg.payload.code);
    });
  }

  /**
   * Subscribe to voice transcription results
   */
  onVoiceTranscription(handler: (text: string, isFinal: boolean) => void): () => void {
    return this.on<{ text: string; isFinal: boolean }>('voice_transcription', (msg) => {
      handler(msg.payload.text, msg.payload.isFinal);
    });
  }

  /**
   * Subscribe to TTS audio chunks
   */
  onTTSChunk(handler: (data: string, format: string) => void): () => void {
    return this.on<{ data: string; format: string }>('tts_audio_chunk', (msg) => {
      handler(msg.payload.data, msg.payload.format);
    });
  }

  /**
   * Subscribe to TTS audio end
   */
  onTTSEnd(handler: () => void): () => void {
    return this.on('tts_audio_end', () => {
      handler();
    });
  }

  // ===========================================================================
  // Voice Call Event Handlers
  // ===========================================================================

  /**
   * Subscribe to voice call started confirmation
   */
  onVoiceCallStarted(handler: (data: { startedAt?: string; currentBalance?: number }) => void): () => void {
    return this.on<{ startedAt?: string; currentBalance?: number }>('voice_call_started', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to voice call ended
   */
  onVoiceCallEnded(handler: (data: { duration?: number; reason?: string; tokensUsed?: number }) => void): () => void {
    return this.on<{ duration?: number; reason?: string; tokensUsed?: number }>('voice_call_ended', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to voice call insufficient tokens
   */
  onVoiceCallInsufficientTokens(handler: (data: { balance: number; required: number }) => void): () => void {
    return this.on<{ balance: number; required: number }>('voice_call_insufficient_tokens', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to voice call balance updates during active call
   */
  onVoiceCallBalanceUpdate(handler: (data: { balance: number; tokensUsed: number }) => void): () => void {
    return this.on<{ balance: number; tokensUsed: number }>('voice_call_balance_update', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to game updates
   */
  onGameUpdate(handler: (activeGame: Record<string, unknown> | null) => void): () => void {
    return this.on<{ activeGame: Record<string, unknown> | null }>('game_update', (msg) => {
      handler(msg.payload.activeGame);
    });
  }

  /**
   * Subscribe to like acknowledgments
   */
  onLikeAcknowledged(
    handler: (data: { turnId: string; turnLikes: number; sessionLikes: number; contentSnippet: string }) => void
  ): () => void {
    return this.on<{ turnId: string; turnLikes: number; sessionLikes: number; contentSnippet: string }>(
      'like_acknowledged',
      (msg) => {
        handler(msg.payload);
      }
    );
  }

  // ===========================================================================
  // Group Chat Event Handlers
  // ===========================================================================

  /**
   * Subscribe to companion joined events
   */
  onCompanionJoined(
    handler: (data: {
      companion: GroupParticipant;
      invitedByCompanionId: string;
      reason: string;
      participants: GroupParticipant[];
    }) => void
  ): () => void {
    return this.on<{
      companion: GroupParticipant;
      invitedByCompanionId: string;
      reason: string;
      participants: GroupParticipant[];
    }>('companion_joined', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to companion left events
   */
  onCompanionLeft(
    handler: (data: {
      companionId: string;
      companionName: string;
      reason: string;
      participants: GroupParticipant[];
    }) => void
  ): () => void {
    return this.on<{
      companionId: string;
      companionName: string;
      reason: string;
      participants: GroupParticipant[];
    }>('companion_left', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to group chat state updates
   */
  onGroupChatState(handler: (state: GroupChatState) => void): () => void {
    return this.on<GroupChatState>('group_chat_state', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to companion message start (group chat)
   */
  onCompanionMessageStart(
    handler: (data: {
      companionId: string;
      companionName: string;
      themeColor: string;
      isReaction: boolean;
      turnId: string;
    }) => void
  ): () => void {
    return this.on<{
      companionId: string;
      companionName: string;
      themeColor: string;
      isReaction: boolean;
      turnId: string;
    }>('companion_message_start', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to companion message chunks (group chat streaming)
   */
  onCompanionMessageChunk(handler: (companionId: string, content: string) => void): () => void {
    return this.on<{ companionId: string; content: string }>('companion_message_chunk', (msg) => {
      handler(msg.payload.companionId, msg.payload.content);
    });
  }

  /**
   * Subscribe to companion message end (group chat)
   */
  onCompanionMessageEnd(
    handler: (data: {
      companionId: string;
      companionName: string;
      content: string;
      isReaction: boolean;
      turnId: string;
      imagePrompt?: string;
      shouldGenerateImage?: boolean;
      imageIntentConfidence?: number;
    }) => void
  ): () => void {
    return this.on<{
      companionId: string;
      companionName: string;
      content: string;
      isReaction: boolean;
      turnId: string;
      imagePrompt?: string;
      shouldGenerateImage?: boolean;
      imageIntentConfidence?: number;
    }>('companion_message_end', (msg) => {
      handler(msg.payload);
    });
  }

  // ===========================================================================
  // Demo/Anonymous Session Event Handlers
  // ===========================================================================

  /**
   * Subscribe to usage updates (for anonymous sessions)
   */
  onUsageUpdate(
    handler: (data: { messagesUsed: number; messageLimit: number; remaining: number }) => void
  ): () => void {
    return this.on<{ messagesUsed: number; messageLimit: number }>('usage_update', (msg) => {
      handler({
        ...msg.payload,
        remaining: msg.payload.messageLimit - msg.payload.messagesUsed,
      });
    });
  }

  /**
   * Subscribe to limit reached events (for anonymous sessions)
   */
  onLimitReached(
    handler: (data: { messagesUsed: number; engagementScore?: number; reason?: string }) => void
  ): () => void {
    return this.on<{ messagesUsed: number; engagementScore?: number; reason?: string }>('limit_reached', (msg) => {
      handler(msg.payload);
    });
  }

  /**
   * Subscribe to engagement updates (for anonymous sessions)
   */
  onEngagementUpdate(
    handler: (data: {
      messagesUsed: number;
      engagementScore: number;
      maxMessages: number;
      engagementLevel: 'low' | 'medium' | 'high';
      analysis: { emotionalDepth: number; investment: number; combined: number };
    }) => void
  ): () => void {
    return this.on<{
      messagesUsed: number;
      engagementScore: number;
      maxMessages: number;
      engagementLevel: 'low' | 'medium' | 'high';
      analysis: { emotionalDepth: number; investment: number; combined: number };
    }>('engagement_update', (msg) => {
      this._engagementScore = msg.payload.engagementScore;
      handler(msg.payload);
    });
  }

  private handleMessage(message: WSMessage): void {
    // Handle internal state updates
    switch (message.type) {
      case 'auth_success':
        this._isAuthenticated = true;
        console.log('[WS] Authenticated');
        break;
      case 'auth_error':
        this._isAuthenticated = false;
        console.error('[WS] Auth failed', message.payload);
        break;
      case 'session_started': {
        const payload = message.payload as {
          sessionId: string;
          isGroupChat?: boolean;
          participants?: GroupParticipant[];
        };
        this._sessionId = payload.sessionId;
        this._isGroupChat = payload.isGroupChat || false;
        this._groupParticipants.clear();
        if (payload.participants) {
          for (const p of payload.participants) {
            this._groupParticipants.set(p.companionId, p);
          }
        }
        console.log('[WS] Session started', this._sessionId, 'isGroupChat:', this._isGroupChat);
        // Flush any pending messages queued during iOS keyboard race condition
        this.flushPendingMessages();
        break;
      }
      case 'session_ended':
        this._sessionId = null;
        this._isGroupChat = false;
        this._groupParticipants.clear();
        console.log('[WS] Session ended');
        break;
      case 'ping':
        this.send('pong', {});
        break;
      // Group chat state updates
      case 'companion_joined': {
        const payload = message.payload as {
          companion: GroupParticipant;
          participants: GroupParticipant[];
        };
        this._groupParticipants.set(payload.companion.companionId, payload.companion);
        this._isGroupChat = this._groupParticipants.size > 1;
        console.log('[WS] Companion joined:', payload.companion.companionName);
        break;
      }
      case 'companion_left': {
        const payload = message.payload as {
          companionId: string;
          participants: GroupParticipant[];
        };
        this._groupParticipants.delete(payload.companionId);
        this._isGroupChat = this._groupParticipants.size > 1;
        console.log('[WS] Companion left:', payload.companionId);
        break;
      }
      case 'group_chat_state': {
        const payload = message.payload as GroupChatState;
        this._isGroupChat = payload.isGroupChat;
        this._groupParticipants.clear();
        for (const p of payload.participants) {
          this._groupParticipants.set(p.companionId, p);
        }
        console.log('[WS] Group chat state updated, participants:', payload.participants.length);
        break;
      }
      // Demo/anonymous session state updates
      case 'usage_update': {
        const payload = message.payload as {
          messagesUsed: number;
          messageLimit: number;
        };
        this._messagesUsed = payload.messagesUsed;
        this._messageLimit = payload.messageLimit;
        console.log('[WS] Usage update:', this._messagesUsed, '/', this._messageLimit);
        break;
      }
      case 'limit_reached': {
        const payload = message.payload as {
          messagesUsed: number;
          engagementScore?: number;
        };
        this._messagesUsed = payload.messagesUsed;
        if (payload.engagementScore !== undefined) {
          this._engagementScore = payload.engagementScore;
        }
        console.log('[WS] Conversion triggered at message:', this._messagesUsed, 'engagement:', this._engagementScore);
        break;
      }
      case 'engagement_update': {
        const payload = message.payload as {
          messagesUsed: number;
          engagementScore: number;
          maxMessages: number;
        };
        this._messagesUsed = payload.messagesUsed;
        this._messageLimit = payload.maxMessages;
        this._engagementScore = payload.engagementScore;
        console.log('[WS] Engagement update:', this._engagementScore, 'messages:', this._messagesUsed, '/', this._messageLimit);
        break;
      }
    }

    // Call registered handlers
    const typeHandlers = this.handlers.get(message.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(message);
        } catch (error) {
          console.error('[WS] Handler error', error);
        }
      }
    }

    // Call wildcard handlers
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
  }

  private scheduleReconnect(): void {
    // Prevent duplicate reconnection timers
    if (this.reconnectTimeout) {
      console.log('[WS] Reconnection already scheduled, skipping duplicate');
      return;
    }

    console.log(`[WS] Reconnecting in ${this.options.reconnectDelay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      // Reset state before reconnecting to prevent stale data
      this.resetState();
      this.connect();
    }, this.options.reconnectDelay);
  }
}

// Singleton instance for easy access
let instance: CampfireWebSocket | null = null;

export function getWebSocket(): CampfireWebSocket {
  if (!instance) {
    instance = new CampfireWebSocket();
  }
  return instance;
}

export function connectWebSocket(): CampfireWebSocket {
  const ws = getWebSocket();
  ws.connect();
  return ws;
}
