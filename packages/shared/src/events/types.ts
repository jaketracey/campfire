/**
 * All event type constants for the Campfire platform.
 * These are the canonical event type strings used throughout the system.
 */
export const EventTypes = {
  // Session events
  SESSION_STARTED: 'session.started',
  SESSION_ENDED: 'session.ended',

  // Audio/STT events
  AUDIO_CHUNK_RECEIVED: 'audio.chunk.received',
  STT_PARTIAL: 'stt.partial',
  STT_FINAL: 'stt.final',

  // Message events
  USER_MESSAGE_CREATED: 'user.message.created',
  AGENT_MESSAGE_CREATED: 'agent.message.created',

  // LLM events
  LLM_REQUESTED: 'llm.requested',
  LLM_TOKEN: 'llm.token',
  LLM_FINAL: 'llm.final',
  LLM_FAILED: 'llm.failed',

  // Tool events
  TOOL_CALLED: 'tool.called',
  TOOL_SUCCEEDED: 'tool.succeeded',
  TOOL_FAILED: 'tool.failed',

  // Memory events
  MEMORY_PROPOSED: 'memory.proposed',
  MEMORY_WRITTEN: 'memory.written',
  MEMORY_DELETED: 'memory.deleted',
  MEMORY_RETRIEVAL_REQUESTED: 'memory.retrieval.requested',
  MEMORY_RETRIEVAL_COMPLETED: 'memory.retrieval.completed',

  // Knowledge Graph events
  KG_EDGE_PROPOSED: 'kg.edge.proposed',
  KG_EDGE_ADDED: 'kg.edge.added',
  KG_EDGE_REMOVED: 'kg.edge.removed',

  // Avatar/Image events
  AVATAR_REQUESTED: 'avatar.requested',
  AVATAR_GENERATED: 'avatar.generated',
  AVATAR_PROMOTED: 'avatar.promoted',
  IMAGEGEN_REQUESTED: 'imagegen.requested',
  IMAGEGEN_GENERATED: 'imagegen.generated',
  IMAGEGEN_BLOCKED: 'imagegen.blocked',

  // Safety events
  SAFETY_FLAGGED: 'safety.flagged',
  SAFETY_BLOCKED: 'safety.blocked',
  SAFETY_ESCALATED: 'safety.escalated',

  // TTS events
  TTS_REQUESTED: 'tts.requested',
  TTS_CHUNK_READY: 'tts.chunk.ready',
  TTS_COMPLETED: 'tts.completed',

  // Projection events
  PROJECTION_REQUESTED: 'projection.requested',
  PROJECTION_COMPLETED: 'projection.completed',
  VAULT_RENDER_REQUESTED: 'vault.render.requested',
  VAULT_RENDER_COMPLETED: 'vault.render.completed',
  VAULT_RENDER_FAILED: 'vault.render.failed',

  // Cost events
  COST_RECORDED: 'cost.recorded',

  // Companion events
  COMPANION_CREATED: 'companion.created',
  COMPANION_SPEC_UPDATED: 'companion.spec.updated',
  VOICE_SELECTED: 'voice.selected',
  POLICY_ACCEPTED: 'policy.accepted',
  MEMORY_CONSENT_UPDATED: 'memory.consent.updated',

  // Billing events
  BILLING_WEBHOOK_RECEIVED: 'billing.webhook.received',
  BILLING_CHECKOUT_COMPLETED: 'billing.checkout.completed',
  BILLING_INVOICE_PAID: 'billing.invoice.paid',
  BILLING_PAYMENT_FAILED: 'billing.payment_failed',
  BILLING_SUBSCRIPTION_UPDATED: 'billing.subscription.updated',
  BILLING_SUBSCRIPTION_CANCELED: 'billing.subscription.canceled',

  // Email events
  EMAIL_QUEUED: 'email.queued',
  EMAIL_SENT: 'email.sent',
  EMAIL_FAILED: 'email.failed',
  EMAIL_BOUNCED: 'email.bounced',
  EMAIL_COMPLAINED: 'email.complained',
  EMAIL_OPENED: 'email.opened',
  EMAIL_CLICKED: 'email.clicked',
  EMAIL_UNSUBSCRIBED: 'email.unsubscribed',
  EMAIL_PREFERENCES_UPDATED: 'email.preferences.updated',

  // Gift events
  GIFT_GENERATED: 'gift.generated',
  GIFT_RECEIVED: 'gift.received',
  GIFT_ACKNOWLEDGED: 'gift.acknowledged',
  GIFT_MEMORY_RECALLED: 'gift.memory.recalled',

  // Token events
  TOKENS_PURCHASED: 'tokens.purchased',
  TOKENS_BONUS_GRANTED: 'tokens.bonus_granted',
  TOKENS_SPENT: 'tokens.spent',

  // Group Chat events
  COMPANION_INVITED: 'companion.invited',
  COMPANION_JOINED: 'companion.joined',
  COMPANION_LEFT: 'companion.left',
  COMPANION_MESSAGE_START: 'companion.message.start',
  COMPANION_MESSAGE_CHUNK: 'companion.message.chunk',
  COMPANION_MESSAGE_END: 'companion.message.end',
  GROUP_CHAT_STATE_UPDATE: 'group.chat.state.update',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];

/**
 * Event type categories for filtering and routing
 */
export const EventCategories = {
  SESSION: ['session.started', 'session.ended'],
  AUDIO: ['audio.chunk.received', 'stt.partial', 'stt.final'],
  MESSAGE: ['user.message.created', 'agent.message.created'],
  LLM: ['llm.requested', 'llm.token', 'llm.final', 'llm.failed'],
  TOOL: ['tool.called', 'tool.succeeded', 'tool.failed'],
  MEMORY: ['memory.proposed', 'memory.written', 'memory.deleted', 'memory.retrieval.requested', 'memory.retrieval.completed'],
  KG: ['kg.edge.proposed', 'kg.edge.added', 'kg.edge.removed'],
  AVATAR: ['avatar.requested', 'avatar.generated', 'avatar.promoted'],
  IMAGEGEN: ['imagegen.requested', 'imagegen.generated', 'imagegen.blocked'],
  SAFETY: ['safety.flagged', 'safety.blocked', 'safety.escalated'],
  TTS: ['tts.requested', 'tts.chunk.ready', 'tts.completed'],
  PROJECTION: ['projection.requested', 'projection.completed', 'vault.render.requested', 'vault.render.completed', 'vault.render.failed'],
  COST: ['cost.recorded'],
  COMPANION: ['companion.created', 'companion.spec.updated', 'voice.selected', 'policy.accepted', 'memory.consent.updated'],
  BILLING: ['billing.webhook.received', 'billing.checkout.completed', 'billing.invoice.paid', 'billing.payment_failed', 'billing.subscription.updated', 'billing.subscription.canceled'],
  SECURITY: ['security.mfa.required', 'security.mfa.enabled'],
  DEPLOY: ['deploy.started', 'deploy.completed', 'deploy.failed'],
  EMAIL: [
    'email.queued',
    'email.sent',
    'email.failed',
    'email.bounced',
    'email.complained',
    'email.opened',
    'email.clicked',
    'email.unsubscribed',
    'email.preferences.updated',
  ],
  GIFT: ['gift.generated', 'gift.received', 'gift.acknowledged', 'gift.memory.recalled'],
  TOKENS: ['tokens.purchased', 'tokens.bonus_granted', 'tokens.spent'],
  GROUP_CHAT: [
    'companion.invited',
    'companion.joined',
    'companion.left',
    'companion.message.start',
    'companion.message.chunk',
    'companion.message.end',
    'group.chat.state.update',
  ],
} as const;

export type EventCategory = keyof typeof EventCategories;
