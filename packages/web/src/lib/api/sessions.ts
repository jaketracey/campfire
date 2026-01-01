/**
 * Sessions API
 * Conversation session management.
 */

import { get, post, patch, del } from './client';

export interface Session {
  id: string;
  companionId: string;
  title: string | null;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  lastMessageAt: string | null;
  metadata?: Record<string, unknown>;
  summary?: string;
}

export interface Turn {
  id: string;
  turnNumber: number;
  userMessage: string;
  agentMessage: string;
  createdAt: string;
  latencyMs: number | null;
  toolsUsed: string[] | null;
}

export interface CreateSessionInput {
  companionId: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionInput {
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SendMessageInput {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SessionListResponse {
  sessions: Session[];
  limit: number;
  offset: number;
}

export interface TurnListResponse {
  turns: Turn[];
  limit: number;
  offset: number;
}

/**
 * List sessions for current user
 */
export function listSessions(options?: {
  limit?: number;
  offset?: number;
  companionId?: string;
  status?: 'active' | 'ended';
}): Promise<SessionListResponse> {
  return get<SessionListResponse>('/sessions', options);
}

/**
 * Get session by ID
 */
export function getSession(sessionId: string): Promise<Session> {
  return get<Session>(`/sessions/${sessionId}`);
}

/**
 * Create a new session
 */
export function createSession(input: CreateSessionInput): Promise<Session> {
  return post<Session>('/sessions', input);
}

/**
 * Update a session
 */
export function updateSession(
  sessionId: string,
  input: UpdateSessionInput
): Promise<Session> {
  return patch<Session>(`/sessions/${sessionId}`, input);
}

/**
 * End a session
 */
export function endSession(sessionId: string): Promise<Session> {
  return post<Session>(`/sessions/${sessionId}/end`);
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): Promise<void> {
  return del<void>(`/sessions/${sessionId}`);
}

/**
 * Get turns (messages) for a session
 */
export function getSessionTurns(
  sessionId: string,
  options?: { limit?: number; offset?: number }
): Promise<TurnListResponse> {
  return get<TurnListResponse>(`/sessions/${sessionId}/turns`, options);
}

/**
 * Send a message to a session (non-streaming, REST fallback)
 */
export function sendMessage(
  sessionId: string,
  input: SendMessageInput
): Promise<Turn> {
  return post<Turn>(`/sessions/${sessionId}/message`, input);
}
