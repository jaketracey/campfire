/**
 * WebSocket Client
 * Real-time communication with the gateway.
 */

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3002/ws';

export type WSMessageType =
  | 'ping'
  | 'pong'
  | 'auth'
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
  private _isConnected = false;
  private _isAuthenticated = false;
  private _sessionId: string | null = null;
  private _isGroupChat = false;
  private _groupParticipants: Map<string, GroupParticipant> = new Map();

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

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(WS_BASE_URL);

    this.ws.onopen = () => {
      this._isConnected = true;
      console.log('[WS] Connected');
      this.options.onOpen?.();
    };

    this.ws.onclose = (event) => {
      this._isConnected = false;
      this._isAuthenticated = false;
      this._sessionId = null;
      console.log('[WS] Disconnected', event.code, event.reason);
      this.options.onClose?.(event);

      // Auto-reconnect
      if (this.options.autoReconnect && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Error', error);
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this._isConnected = false;
    this._isAuthenticated = false;
    this._sessionId = null;
    this._isGroupChat = false;
    this._groupParticipants.clear();
  }

  /**
   * Send a message
   */
  send<T>(type: WSMessageType, payload: T): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[WS] Cannot send - not connected');
      return;
    }

    const message: WSMessage<T> = {
      type,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      payload,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Authenticate with a token
   */
  authenticate(token: string): void {
    this.send('auth', { token });
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
    this.handlers.get(type)!.add(handler as MessageHandler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler as MessageHandler);
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
      sequence?: { index: number; total: number; isLast: boolean; typingDelayMs?: number }
    ) => void
  ): () => void {
    return this.on<{
      content: string;
      imagePrompt?: string;
      sequence?: { index: number; total: number; isLast: boolean; typingDelayMs?: number };
    }>('agent_message_end', (msg) => {
      handler(msg.payload.content, msg.payload.imagePrompt, msg.payload.sequence);
    });
  }

  /**
   * Subscribe to errors
   */
  onError(handler: (message: string) => void): () => void {
    return this.on<{ message: string }>('error', (msg) => {
      handler(msg.payload.message);
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
    }) => void
  ): () => void {
    return this.on<{
      companionId: string;
      companionName: string;
      content: string;
      isReaction: boolean;
      turnId: string;
    }>('companion_message_end', (msg) => {
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
    if (this.reconnectTimeout) return;

    console.log(`[WS] Reconnecting in ${this.options.reconnectDelay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
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
