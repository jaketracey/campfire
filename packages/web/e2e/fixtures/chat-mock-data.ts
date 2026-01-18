/**
 * Mock data for Chat E2E tests
 * These fixtures represent deterministic data for testing chat flows.
 */

// ============================================================================
// Companion Fixtures
// ============================================================================

export const mockCompanion = {
  id: 'cmp_test123',
  name: 'Luna',
  description: 'A creative digital artist',
  avatarUrl: 'https://example.com/avatar.jpg',
  voiceId: 'EXAVITQu4vr4xnSDxMaL',
  isPublic: false,
  isActive: true,
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  ownerId: 'user_test123',
  spec: {
    identity: {
      name: 'Luna',
      pronouns: 'she/her',
      backstory: 'A digital artist from Neo Tokyo',
    },
    personality: {
      archetype: 'creator',
      traits: {
        warmth: 0.7,
        playfulness: 0.65,
        curiosity: 0.8,
      },
    },
    visual_style: {
      appearance: {
        gender: 'female',
        ethnicity: 'east-asian',
        bodyType: 'athletic',
        hairColor: 'fantasy',
        breastSize: 'M',
      },
    },
  },
  specVersion: 1,
};

export const mockSecondCompanion = {
  id: 'cmp_test456',
  name: 'Marcus',
  description: 'A wise philosopher',
  avatarUrl: 'https://example.com/avatar2.jpg',
  voiceId: 'daniel',
  isPublic: false,
  isActive: true,
  status: 'active',
  createdAt: '2024-01-02T00:00:00.000Z',
  ownerId: 'user_test123',
  spec: {
    identity: {
      name: 'Marcus',
      pronouns: 'he/him',
      backstory: 'A wandering philosopher',
    },
    personality: {
      archetype: 'sage',
      traits: {
        warmth: 0.55,
        playfulness: 0.35,
        curiosity: 0.65,
      },
    },
    visual_style: {
      appearance: {
        gender: 'male',
        ethnicity: 'caucasian',
        bodyType: 'athletic',
        hairColor: 'brown',
        build: 'M',
      },
    },
  },
  specVersion: 1,
};

// ============================================================================
// Demo Companion Fixtures
// ============================================================================

export const mockDemoCompanion = {
  id: 'demo_companion_001',
  name: 'Aria',
  description: 'A friendly demo companion',
  avatarUrl: 'https://example.com/demo-avatar.jpg',
  voiceId: 'shimmer',
  isDemo: true,
};

// ============================================================================
// Session Fixtures
// ============================================================================

export const mockSession = {
  id: 'ses_test123',
  companionId: 'cmp_test123',
  userId: 'user_test123',
  title: 'Chat with Luna',
  status: 'active',
  createdAt: '2024-01-15T10:00:00.000Z',
  lastActivityAt: '2024-01-15T10:30:00.000Z',
  messageCount: 10,
};

export const mockDemoSession = {
  id: 'demo_ses_001',
  companionId: 'demo_companion_001',
  fingerprint: 'fp_test123',
  status: 'active',
  createdAt: new Date().toISOString(),
  messageCount: 0,
  maxMessages: 5,
};

// ============================================================================
// Message Fixtures
// ============================================================================

export const mockMessages = [
  {
    id: 'msg_001',
    sessionId: 'ses_test123',
    role: 'user' as const,
    content: 'Hello Luna! How are you today?',
    createdAt: '2024-01-15T10:00:00.000Z',
  },
  {
    id: 'msg_002',
    sessionId: 'ses_test123',
    role: 'assistant' as const,
    content: "Hi there! I'm doing great, thanks for asking! I've been working on some new digital art pieces. What brings you here today?",
    createdAt: '2024-01-15T10:00:30.000Z',
  },
  {
    id: 'msg_003',
    sessionId: 'ses_test123',
    role: 'user' as const,
    content: 'I wanted to see your latest artwork!',
    createdAt: '2024-01-15T10:01:00.000Z',
  },
  {
    id: 'msg_004',
    sessionId: 'ses_test123',
    role: 'assistant' as const,
    content: "*smiles excitedly* Oh, I'd love to show you! I've been experimenting with cyberpunk cityscapes lately. The neon lights and rain-slicked streets are so atmospheric!",
    createdAt: '2024-01-15T10:01:30.000Z',
  },
];

// ============================================================================
// WebSocket Event Fixtures
// ============================================================================

export const mockWSEvents = {
  // Chat events
  messageChunk: (content: string, messageId: string = 'msg_stream') => ({
    type: 'message_chunk',
    data: {
      messageId,
      content,
      isComplete: false,
    },
  }),

  messageComplete: (content: string, messageId: string = 'msg_complete') => ({
    type: 'message_complete',
    data: {
      messageId,
      content,
      emotionalState: 'happy',
    },
  }),

  messageEnd: () => ({
    type: 'message_end',
    data: {},
  }),

  typingStart: () => ({
    type: 'typing_start',
    data: {},
  }),

  typingStop: () => ({
    type: 'typing_stop',
    data: {},
  }),

  error: (message: string) => ({
    type: 'error',
    data: {
      message,
      code: 'CHAT_ERROR',
    },
  }),

  // Group chat events
  participantJoined: (companion: typeof mockSecondCompanion) => ({
    type: 'participant_joined',
    data: {
      companionId: companion.id,
      companionName: companion.name,
      avatarUrl: companion.avatarUrl,
    },
  }),

  participantLeft: (companionId: string, companionName: string) => ({
    type: 'participant_left',
    data: {
      companionId,
      companionName,
    },
  }),

  // Game events
  gameStarted: (gameType: string) => ({
    type: 'game_started',
    data: {
      gameId: 'game_001',
      gameType,
      initialState: {
        board: Array(9).fill(null),
        currentPlayer: 'X',
        winner: null,
        isDraw: false,
      },
    },
  }),

  gameMove: (position: number, player: 'X' | 'O') => ({
    type: 'game_move',
    data: {
      gameId: 'game_001',
      position,
      player,
      board: Array(9).fill(null),
    },
  }),

  gameOver: (winner: 'X' | 'O' | null) => ({
    type: 'game_over',
    data: {
      gameId: 'game_001',
      winner,
      isDraw: winner === null,
    },
  }),

  // Gift events
  giftReceived: (giftId: string, giftName: string) => ({
    type: 'gift_received',
    data: {
      giftId,
      giftName,
      senderName: 'User',
      message: 'Thanks for the gift!',
    },
  }),

  // Voice events
  transcription: (text: string, isFinal: boolean) => ({
    type: 'transcription',
    data: {
      text,
      isFinal,
    },
  }),

  ttsStart: () => ({
    type: 'tts_start',
    data: {},
  }),

  ttsEnd: () => ({
    type: 'tts_end',
    data: {},
  }),

  // Demo mode events
  limitReached: () => ({
    type: 'limit_reached',
    data: {
      messagesUsed: 5,
      maxMessages: 5,
      reason: 'message_limit',
    },
  }),

  demoUsageUpdate: (messagesUsed: number) => ({
    type: 'demo_usage_update',
    data: {
      messagesUsed,
      maxMessages: 5,
      messagesRemaining: Math.max(0, 5 - messagesUsed),
    },
  }),
};

// ============================================================================
// Streaming Response Helpers
// ============================================================================

export function createStreamingChunks(
  fullContent: string,
  chunkSize: number = 10
): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < fullContent.length; i += chunkSize) {
    chunks.push(fullContent.slice(i, i + chunkSize));
  }
  return chunks;
}

// ============================================================================
// API Response Fixtures
// ============================================================================

export const mockChatAPIResponses = {
  sendMessage: (content: string) => ({
    success: true,
    messageId: `msg_${Date.now()}`,
  }),

  getSession: {
    session: mockSession,
    companion: mockCompanion,
    messages: mockMessages,
  },

  getDemoSession: {
    session: mockDemoSession,
    companion: mockDemoCompanion,
    messagesRemaining: 5,
  },

  createSession: {
    session: mockSession,
  },

  createDemoSession: {
    session: mockDemoSession,
  },

  likeMessage: (messageId: string, likes: number) => ({
    success: true,
    messageId,
    likes,
  }),

  sendGift: (giftId: string) => ({
    success: true,
    giftId,
    message: 'Gift sent successfully!',
  }),

  startGame: (gameType: string) => ({
    success: true,
    gameId: 'game_001',
    gameType,
    initialState: {
      board: Array(9).fill(null),
      currentPlayer: 'X',
    },
  }),
};

// ============================================================================
// Gift Fixtures
// ============================================================================

export const mockGifts = [
  {
    id: 'gift_rose',
    name: 'Rose',
    price: 10,
    imageUrl: 'https://example.com/rose.png',
    category: 'romantic',
  },
  {
    id: 'gift_coffee',
    name: 'Coffee',
    price: 5,
    imageUrl: 'https://example.com/coffee.png',
    category: 'casual',
  },
  {
    id: 'gift_diamond',
    name: 'Diamond',
    price: 100,
    imageUrl: 'https://example.com/diamond.png',
    category: 'luxury',
  },
];

// ============================================================================
// Game State Fixtures
// ============================================================================

export const mockTicTacToeState = {
  initial: {
    gameId: 'game_001',
    gameType: 'tic_tac_toe',
    board: Array(9).fill(null),
    currentPlayer: 'X' as const,
    winner: null,
    isDraw: false,
  },
  userMove: {
    gameId: 'game_001',
    gameType: 'tic_tac_toe',
    board: ['X', null, null, null, null, null, null, null, null],
    currentPlayer: 'O' as const,
    winner: null,
    isDraw: false,
  },
  companionMove: {
    gameId: 'game_001',
    gameType: 'tic_tac_toe',
    board: ['X', null, null, null, 'O', null, null, null, null],
    currentPlayer: 'X' as const,
    winner: null,
    isDraw: false,
  },
  userWins: {
    gameId: 'game_001',
    gameType: 'tic_tac_toe',
    board: ['X', 'X', 'X', 'O', 'O', null, null, null, null],
    currentPlayer: 'O' as const,
    winner: 'X' as const,
    isDraw: false,
  },
  draw: {
    gameId: 'game_001',
    gameType: 'tic_tac_toe',
    board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'],
    currentPlayer: 'X' as const,
    winner: null,
    isDraw: true,
  },
};

// ============================================================================
// Demo Mode Fixtures
// ============================================================================

export const mockDemoModeState = {
  messagesRemaining: 5,
  maxMessages: 5,
  isLimitReached: false,
};

export const mockDemoLimitReached = {
  messagesRemaining: 0,
  maxMessages: 5,
  isLimitReached: true,
};

// ============================================================================
// Demo API Fixtures
// ============================================================================

export const mockDemoAPIResponses = {
  getDemoCompanion: {
    success: true,
    data: {
      companion: {
        id: 'demo_companion_001',
        name: 'Aria',
        avatarUrl: 'https://example.com/demo-avatar.jpg',
        archetype: 'friendly',
        description: 'A friendly demo companion',
      },
    },
  },

  createDemoSession: (messagesUsed = 0) => ({
    success: true,
    data: {
      session: {
        id: 'demo_ses_001',
        companionId: 'demo_companion_001',
        status: 'active',
        startedAt: new Date().toISOString(),
      },
      usage: {
        messagesUsed,
        fingerprint: 'fp_test123',
      },
    },
  }),

  getDemoSessionInfo: (messagesUsed = 0) => ({
    session: mockDemoSession,
    companion: mockDemoCompanion,
    messages: [],
    messagesUsed,
    maxMessages: 5,
  }),
};
