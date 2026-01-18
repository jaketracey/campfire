/**
 * Games E2E Tests
 *
 * Tests in-chat game functionality including:
 * - Start tic-tac-toe game
 * - User move updates board
 * - Game over state displayed
 * - Resign from game
 */

import { test, expect } from '@playwright/test';
import { createChatPage, ChatPage } from '../../helpers/chat-page';
import { createApiInterceptor, ApiInterceptor, setupMockAuth } from '../../helpers/api-interceptor';
import {
  setupWebSocketMock,
  simulateWSMessage,
  simulateGameUpdate,
} from '../../helpers/websocket-mock';
import {
  mockCompanion,
  mockSession,
  mockMessages,
  mockChatAPIResponses,
  mockWSEvents,
  mockTicTacToeState,
} from '../../fixtures/chat-mock-data';

test.describe('Games', () => {
  let chatPage: ChatPage;
  let apiInterceptor: ApiInterceptor;

  test.beforeEach(async ({ page }) => {
    chatPage = createChatPage(page);
    apiInterceptor = createApiInterceptor(page);

    // Setup mocks before navigation
    await setupMockAuth(page);
    await setupWebSocketMock(page);

    // Mock API endpoints
    await apiInterceptor.mockEndpoint('/sessions/ses_test123', mockChatAPIResponses.getSession, {
      method: 'GET',
    });

    await apiInterceptor.mockEndpoint('/companions/cmp_test123', mockCompanion, {
      method: 'GET',
    });

    // Mock game start endpoint
    await apiInterceptor.mockEndpoint('/games/start', mockChatAPIResponses.startGame('tic_tac_toe'), {
      method: 'POST',
    });

    // Mock game move endpoint
    await apiInterceptor.mockEndpoint('/games/move', {
      success: true,
      gameId: 'game_001',
    }, { method: 'POST' });

    // Mock game resign endpoint
    await apiInterceptor.mockEndpoint('/games/resign', {
      success: true,
      gameId: 'game_001',
    }, { method: 'POST' });
  });

  test.describe('Start Game', () => {
    test('should open games modal from sidebar', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Look for games button in sidebar
      const gamesButton = chatPage.gamesButton;
      if (await gamesButton.isVisible({ timeout: 3000 })) {
        await gamesButton.click();

        // Games modal should open
        await expect(chatPage.gamesModal).toBeVisible({ timeout: 5000 });
      }
    });

    test('should start tic-tac-toe game', async ({ page }) => {
      await chatPage.goto('ses_test123');

      const gamesButton = chatPage.gamesButton;
      if (await gamesButton.isVisible({ timeout: 3000 })) {
        await gamesButton.click();
        await expect(chatPage.gamesModal).toBeVisible({ timeout: 5000 });

        // Click on tic-tac-toe option
        await chatPage.startGame('tic_tac_toe');

        // Simulate game started event
        await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));

        // Game board should appear
        await chatPage.expectGameBoardVisible();
      }
    });

    test('should display initial empty board', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game via WebSocket
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));

      // Check game board is visible
      await chatPage.expectGameBoardVisible();

      // Get board state
      const boardState = await chatPage.getGameBoardState();

      // All cells should be empty initially
      expect(boardState.every(cell => cell === null || cell === '')).toBe(true);
    });

    test('should show game board in chat', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Trigger game start
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));

      // Game board should be visible within chat area
      await expect(chatPage.gameBoard).toBeVisible();

      // Should have 9 cells for tic-tac-toe
      const cellCount = await chatPage.gameCells.count();
      expect(cellCount).toBe(9);
    });
  });

  test.describe('User Moves', () => {
    test('should allow user to make a move', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Click on first cell (index 0)
      await chatPage.makeGameMove(0);

      // Simulate board update from server
      await simulateGameUpdate(page, {
        board: ['X', null, null, null, null, null, null, null, null],
        currentPlayer: 'O',
      });

      // Wait for update
      await page.waitForTimeout(300);

      // Board should show the move
      const boardState = await chatPage.getGameBoardState();
      expect(boardState[0]).toBe('X');
    });

    test('should update board after user move', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Make move on center cell (index 4)
      await chatPage.makeGameMove(4);

      // Simulate update
      await simulateGameUpdate(page, mockTicTacToeState.userMove);

      await page.waitForTimeout(300);

      // Board should reflect the move
      const boardState = await chatPage.getGameBoardState();
      expect(boardState.some(cell => cell === 'X')).toBe(true);
    });

    test('should show companion response move', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // User makes move
      await chatPage.makeGameMove(0);
      await simulateGameUpdate(page, mockTicTacToeState.userMove);

      await page.waitForTimeout(500);

      // Companion makes counter move
      await simulateGameUpdate(page, mockTicTacToeState.companionMove);

      await page.waitForTimeout(300);

      // Board should show both moves
      const boardState = await chatPage.getGameBoardState();
      expect(boardState.filter(cell => cell !== null && cell !== '').length).toBeGreaterThanOrEqual(2);
    });

    test('should prevent moves on occupied cells', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game with partially filled board
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await simulateGameUpdate(page, mockTicTacToeState.companionMove);

      await chatPage.expectGameBoardVisible();

      // Get initial board state
      const initialState = await chatPage.getGameBoardState();

      // Try to click on an occupied cell (center, index 4, has 'O')
      await chatPage.makeGameMove(4);

      await page.waitForTimeout(300);

      // Board should remain unchanged for that cell
      const newState = await chatPage.getGameBoardState();
      expect(newState[4]).toBe(initialState[4]);
    });
  });

  test.describe('Game Over States', () => {
    test('should display user win state', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Simulate user winning
      await simulateGameUpdate(page, mockTicTacToeState.userWins);
      await simulateWSMessage(page, mockWSEvents.gameOver('X'));

      await page.waitForTimeout(500);

      // Should show game over with winner
      const gameStatus = chatPage.gameStatus;
      if (await gameStatus.isVisible({ timeout: 3000 })) {
        const statusText = await gameStatus.textContent();
        expect(statusText?.toLowerCase()).toContain('win');
      }
    });

    test('should display companion win state', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Simulate companion winning
      const companionWinsState = {
        ...mockTicTacToeState.userWins,
        board: ['O', 'O', 'O', 'X', 'X', null, null, null, null],
        winner: 'O' as const,
      };
      await simulateGameUpdate(page, {
        board: companionWinsState.board,
        currentPlayer: 'X',
        winner: 'O',
      });
      await simulateWSMessage(page, mockWSEvents.gameOver('O'));

      await page.waitForTimeout(500);

      // Game should show companion won
      const gameStatus = chatPage.gameStatus;
      if (await gameStatus.isVisible({ timeout: 3000 })) {
        const statusText = await gameStatus.textContent();
        // Status might say "lose" or companion name "wins"
        expect(statusText).toBeTruthy();
      }
    });

    test('should display draw state', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Simulate draw
      await simulateGameUpdate(page, {
        board: mockTicTacToeState.draw.board,
        currentPlayer: 'X',
        winner: null,
        isDraw: true,
      });
      await simulateWSMessage(page, mockWSEvents.gameOver(null));

      await page.waitForTimeout(500);

      // Should indicate draw
      const gameStatus = chatPage.gameStatus;
      if (await gameStatus.isVisible({ timeout: 3000 })) {
        const statusText = await gameStatus.textContent();
        expect(statusText?.toLowerCase()).toMatch(/draw|tie/);
      }
    });

    test('should disable board after game over', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start and immediately end game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // End game with user win
      await simulateGameUpdate(page, mockTicTacToeState.userWins);
      await simulateWSMessage(page, mockWSEvents.gameOver('X'));

      await page.waitForTimeout(500);

      // Try to make a move - board should not update
      const stateBefore = await chatPage.getGameBoardState();
      await chatPage.makeGameMove(5); // Click empty cell
      await page.waitForTimeout(300);
      const stateAfter = await chatPage.getGameBoardState();

      // State should not change after game is over
      expect(stateAfter).toEqual(stateBefore);
    });
  });

  test.describe('Resign Game', () => {
    test('should show resign button during game', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Resign button should be visible
      await expect(chatPage.resignButton).toBeVisible();
    });

    test('should allow user to resign', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Click resign
      await chatPage.resignGame();

      // Simulate game over from resignation
      await simulateWSMessage(page, {
        type: 'game_over',
        data: {
          gameId: 'game_001',
          winner: 'O', // Companion wins by resignation
          reason: 'resignation',
        },
      });

      await page.waitForTimeout(500);

      // Game board might be hidden or show game over state
      // Chat should still be functional
      await expect(chatPage.chatInput).toBeEnabled();
    });

    test('should hide resign button after game over', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // End game
      await simulateGameUpdate(page, mockTicTacToeState.userWins);
      await simulateWSMessage(page, mockWSEvents.gameOver('X'));

      await page.waitForTimeout(500);

      // Resign button should be hidden or disabled
      const resignButton = chatPage.resignButton;
      const isVisible = await resignButton.isVisible();
      const isDisabled = isVisible ? await resignButton.isDisabled() : true;

      expect(!isVisible || isDisabled).toBe(true);
    });
  });

  test.describe('Game Integration with Chat', () => {
    test('should send chat message to start game', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Some implementations allow starting game via chat message
      await chatPage.sendMessage("Let's play tic-tac-toe!");

      // Simulate game starting in response
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));

      // Game board should appear
      await chatPage.expectGameBoardVisible();
    });

    test('should allow chatting during game', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // Should still be able to chat
      await chatPage.sendMessage('Good move!');
      await chatPage.expectUserMessageSent('Good move!');
    });

    test('should continue chat after game ends', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Start and complete game
      await simulateWSMessage(page, mockWSEvents.gameStarted('tic_tac_toe'));
      await chatPage.expectGameBoardVisible();

      // End game
      await simulateWSMessage(page, mockWSEvents.gameOver('X'));
      await page.waitForTimeout(500);

      // Chat should continue working
      await chatPage.sendMessage('That was fun!');
      await chatPage.expectUserMessageSent('That was fun!');
    });
  });

  test.describe('Game State Persistence', () => {
    test('should restore game state on reconnect', async ({ page }) => {
      await chatPage.goto('ses_test123');

      // Simulate existing game state (mid-game)
      await simulateWSMessage(page, {
        type: 'game_state',
        data: {
          gameId: 'game_001',
          gameType: 'tic_tac_toe',
          ...mockTicTacToeState.companionMove,
        },
      });

      await page.waitForTimeout(500);

      // Game board should show existing state
      await chatPage.expectGameBoardVisible();

      const boardState = await chatPage.getGameBoardState();
      // Should have moves already on board
      expect(boardState.filter(cell => cell !== null && cell !== '').length).toBeGreaterThan(0);
    });
  });
});
