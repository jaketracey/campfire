/**
 * Domain errors for the games framework. Mapped to HTTP status codes by the
 * internal route handlers; WS handlers convert them into `game:move_rejected`
 * payloads with a structured `reason` field.
 */

export class GameError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = 'GameError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** No in-progress game matching the query. */
export class GameNotFoundError extends GameError {
  constructor(id: string) {
    super(`Game not found: ${id}`, 'GAME_NOT_FOUND', 404);
    this.name = 'GameNotFoundError';
  }
}

/** Unknown `game_type` passed to `getEngine`. */
export class UnknownGameTypeError extends GameError {
  constructor(gameType: string) {
    super(`Unknown game type: ${gameType}`, 'UNKNOWN_GAME_TYPE', 400);
    this.name = 'UnknownGameTypeError';
  }
}

/** The engine's `validateMove` returned `{ ok: false }`. */
export class InvalidMoveError extends GameError {
  constructor(reason: string) {
    super(reason, 'INVALID_MOVE', 400);
    this.name = 'InvalidMoveError';
  }
}

/** Wrong player tried to move (game awaiting the other side). */
export class NotYourTurnError extends GameError {
  constructor(expected: 'user' | 'companion', got: 'user' | 'companion') {
    super(`Not your turn — waiting for ${expected}, got ${got}`, 'NOT_YOUR_TURN', 409);
    this.name = 'NotYourTurnError';
  }
}

/** Move against a terminated game. */
export class GameEndedError extends GameError {
  constructor(status: string) {
    super(`Game already ended (${status})`, 'GAME_ENDED', 409);
    this.name = 'GameEndedError';
  }
}

/**
 * Optimistic-locking failure: the client submitted a move with a stale
 * `clientVersion`. The service short-circuits so the caller can re-fetch
 * and retry (usually harmlessly — the UI just re-renders).
 */
export class VersionConflictError extends GameError {
  constructor(expected: number, got: number) {
    super(
      `Version conflict: server at v${expected}, client submitted v${got}`,
      'VERSION_CONFLICT',
      409,
    );
    this.name = 'VersionConflictError';
  }
}

/** A chat session already has an in-progress game. */
export class GameAlreadyActiveError extends GameError {
  constructor(chatSessionId: string) {
    super(
      `Chat session ${chatSessionId} already has an active game`,
      'GAME_ALREADY_ACTIVE',
      409,
    );
    this.name = 'GameAlreadyActiveError';
  }
}
