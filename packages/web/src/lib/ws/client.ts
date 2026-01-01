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
  | 'error';

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
   * Subscribe to agent message end
   */
  onAgentMessageEnd(handler: (content: string) => void): () => void {
    return this.on<{ content: string }>('agent_message_end', (msg) => {
      handler(msg.payload.content);
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
      case 'session_started':
        this._sessionId = (message.payload as { sessionId: string }).sessionId;
        console.log('[WS] Session started', this._sessionId);
        break;
      case 'session_ended':
        this._sessionId = null;
        console.log('[WS] Session ended');
        break;
      case 'ping':
        this.send('pong', {});
        break;
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
