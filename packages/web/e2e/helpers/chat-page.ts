/**
 * Chat Page Object Model
 * Encapsulates interactions with the chat page and its components.
 */

import { Page, Locator, expect } from '@playwright/test';
import { setupMockAuth, injectMockAuth } from './api-interceptor';
import { setupWebSocketMock } from './websocket-mock';

export class ChatPage {
  readonly page: Page;

  // ============================================================================
  // Chat Input Locators
  // ============================================================================
  readonly chatInput: Locator;
  readonly sendButton: Locator;
  readonly voiceModeToggle: Locator;

  // ============================================================================
  // Chat Messages Locators
  // ============================================================================
  readonly messagesContainer: Locator;
  readonly userMessages: Locator;
  readonly assistantMessages: Locator;
  readonly typingIndicator: Locator;
  readonly streamingMessage: Locator;
  readonly emptyState: Locator;

  // ============================================================================
  // Chat Header Locators
  // ============================================================================
  readonly header: Locator;
  readonly giftsButton: Locator;
  readonly galleryButton: Locator;
  readonly menuButton: Locator;

  // ============================================================================
  // Chat Sidebar Locators
  // ============================================================================
  readonly sidebar: Locator;
  readonly companionAvatar: Locator;
  readonly companionName: Locator;
  readonly personalityButton: Locator;
  readonly backstoryButton: Locator;
  readonly gamesButton: Locator;
  readonly friendsButton: Locator;
  readonly callButton: Locator;

  // ============================================================================
  // Modals/Panels Locators
  // ============================================================================
  readonly giftsPanel: Locator;
  readonly gamesModal: Locator;
  readonly friendsPanel: Locator;
  readonly signupModal: Locator;

  // ============================================================================
  // Game Board Locators
  // ============================================================================
  readonly gameBoard: Locator;
  readonly gameCells: Locator;
  readonly resignButton: Locator;
  readonly gameStatus: Locator;

  // ============================================================================
  // Demo Mode Locators
  // ============================================================================
  readonly demoMessageCount: Locator;
  readonly designCompanionCTA: Locator;

  // ============================================================================
  // Voice Mode Locators
  // ============================================================================
  readonly liveTranscription: Locator;
  readonly ttsIndicator: Locator;

  constructor(page: Page) {
    this.page = page;

    // Chat Input
    this.chatInput = page.locator('[data-testid="chat-input"]');
    this.sendButton = page.locator('[data-testid="chat-send-button"]');
    this.voiceModeToggle = page.locator('[data-testid="voice-mode-toggle"]');

    // Chat Messages
    this.messagesContainer = page.locator('[data-testid="chat-messages"]');
    this.userMessages = page.locator('[data-testid="user-message"]');
    this.assistantMessages = page.locator('[data-testid="assistant-message"]');
    this.typingIndicator = page.locator('[data-testid="typing-indicator"]');
    this.streamingMessage = page.locator('[data-testid="streaming-message"]');
    this.emptyState = page.locator('[data-testid="chat-empty-state"]');

    // Chat Header
    this.header = page.locator('[data-testid="chat-header"]');
    this.giftsButton = page.locator('[data-testid="gifts-button"]');
    this.galleryButton = page.locator('[data-testid="gallery-button"]');
    this.menuButton = page.locator('[data-testid="menu-button"]');

    // Chat Sidebar
    this.sidebar = page.locator('[data-testid="chat-sidebar"]');
    this.companionAvatar = page.locator('[data-testid="companion-avatar"]');
    this.companionName = page.locator('[data-testid="companion-name"]');
    this.personalityButton = page.locator('[data-testid="personality-button"]');
    this.backstoryButton = page.locator('[data-testid="backstory-button"]');
    this.gamesButton = page.locator('[data-testid="games-button"]');
    this.friendsButton = page.locator('[data-testid="friends-button"]');
    this.callButton = page.locator('[data-testid="call-button"]');

    // Modals/Panels
    this.giftsPanel = page.locator('[data-testid="gifts-panel"]');
    this.gamesModal = page.locator('[data-testid="games-modal"]');
    this.friendsPanel = page.locator('[data-testid="friends-panel"]');
    this.signupModal = page.locator('[data-testid="signup-modal"]');

    // Game Board
    this.gameBoard = page.locator('[data-testid="game-board"]');
    this.gameCells = page.locator('[data-testid="game-cell"]');
    this.resignButton = page.locator('[data-testid="resign-button"]');
    this.gameStatus = page.locator('[data-testid="game-status"]');

    // Demo Mode
    this.demoMessageCount = page.locator('[data-testid="demo-message-count"]');
    this.designCompanionCTA = page.locator('[data-testid="design-companion-cta"]');

    // Voice Mode
    this.liveTranscription = page.locator('[data-testid="live-transcription"]');
    this.ttsIndicator = page.locator('[data-testid="tts-indicator"]');
  }

  // ============================================================================
  // Setup Methods
  // ============================================================================

  /**
   * Setup mocks before navigating to the chat page
   */
  async setupMocks() {
    await setupMockAuth(this.page);
    await setupWebSocketMock(this.page);
  }

  /**
   * Navigate to a chat session
   */
  async goto(sessionId: string) {
    await this.page.goto(`/chat/${sessionId}`);
    await this.page.waitForLoadState('networkidle');
    await injectMockAuth(this.page);
  }

  /**
   * Navigate to demo chat
   */
  async gotoDemo() {
    await this.page.goto('/chat/demo');
    await this.page.waitForLoadState('networkidle');
  }

  // ============================================================================
  // Chat Input Methods
  // ============================================================================

  /**
   * Send a message in the chat
   */
  async sendMessage(message: string) {
    await this.chatInput.fill(message);
    await this.sendButton.click();
  }

  /**
   * Get the current input value
   */
  async getInputValue(): Promise<string> {
    return await this.chatInput.inputValue();
  }

  /**
   * Check if input is disabled (loading state)
   */
  async isInputDisabled(): Promise<boolean> {
    const isReadOnly = await this.chatInput.getAttribute('readonly');
    return isReadOnly === 'true' || isReadOnly === '';
  }

  // ============================================================================
  // Chat Messages Methods
  // ============================================================================

  /**
   * Get all user messages
   */
  async getUserMessages(): Promise<string[]> {
    const messages = await this.userMessages.all();
    const texts: string[] = [];
    for (const msg of messages) {
      texts.push((await msg.textContent()) || '');
    }
    return texts;
  }

  /**
   * Get all assistant messages
   */
  async getAssistantMessages(): Promise<string[]> {
    const messages = await this.assistantMessages.all();
    const texts: string[] = [];
    for (const msg of messages) {
      texts.push((await msg.textContent()) || '');
    }
    return texts;
  }

  /**
   * Get the total message count
   */
  async getMessageCount(): Promise<number> {
    const user = await this.userMessages.count();
    const assistant = await this.assistantMessages.count();
    return user + assistant;
  }

  /**
   * Wait for typing indicator to appear
   */
  async waitForTypingIndicator(timeout = 5000) {
    await this.typingIndicator.waitFor({ state: 'visible', timeout });
  }

  /**
   * Wait for typing indicator to disappear
   */
  async waitForTypingIndicatorGone(timeout = 10000) {
    await this.typingIndicator.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Get the streaming message content
   */
  async getStreamingContent(): Promise<string> {
    return (await this.streamingMessage.textContent()) || '';
  }

  // ============================================================================
  // Sidebar Methods
  // ============================================================================

  /**
   * Open gifts panel
   */
  async openGiftsPanel() {
    await this.giftsButton.click();
    await this.giftsPanel.waitFor({ state: 'visible' });
  }

  /**
   * Open games modal
   */
  async openGamesModal() {
    await this.gamesButton.click();
    await this.gamesModal.waitFor({ state: 'visible' });
  }

  /**
   * Open friends panel
   */
  async openFriendsPanel() {
    await this.friendsButton.click();
    await this.friendsPanel.waitFor({ state: 'visible' });
  }

  /**
   * Start a voice call
   */
  async startCall() {
    await this.callButton.click();
  }

  // ============================================================================
  // Gift Methods
  // ============================================================================

  /**
   * Send a gift by clicking on a gift item
   */
  async sendGift(giftTestId: string) {
    const giftItem = this.page.locator(`[data-testid="${giftTestId}"]`);
    await giftItem.click();
  }

  /**
   * Close the gifts panel
   */
  async closeGiftsPanel() {
    const closeButton = this.giftsPanel.locator('[data-testid="close-panel"]');
    await closeButton.click();
    await this.giftsPanel.waitFor({ state: 'hidden' });
  }

  // ============================================================================
  // Game Methods
  // ============================================================================

  /**
   * Start a game from the games modal
   */
  async startGame(gameType: string) {
    const gameOption = this.gamesModal.locator(`[data-testid="game-${gameType}"]`);
    await gameOption.click();
  }

  /**
   * Make a move on the game board
   */
  async makeGameMove(cellIndex: number) {
    const cell = this.gameCells.nth(cellIndex);
    await cell.click();
  }

  /**
   * Resign from the current game
   */
  async resignGame() {
    await this.resignButton.click();
  }

  /**
   * Get the current game board state
   */
  async getGameBoardState(): Promise<(string | null)[]> {
    const cells = await this.gameCells.all();
    const state: (string | null)[] = [];
    for (const cell of cells) {
      const text = await cell.textContent();
      state.push(text || null);
    }
    return state;
  }

  // ============================================================================
  // Like Methods
  // ============================================================================

  /**
   * Like a message by index
   */
  async likeMessage(messageIndex: number) {
    const likeButton = this.assistantMessages
      .nth(messageIndex)
      .locator('[data-testid="like-button"]');
    await likeButton.click();
  }

  /**
   * Get the like count for a message
   */
  async getMessageLikeCount(messageIndex: number): Promise<number> {
    const likeCount = this.assistantMessages
      .nth(messageIndex)
      .locator('[data-testid="like-count"]');
    const text = await likeCount.textContent();
    return parseInt(text || '0', 10);
  }

  // ============================================================================
  // Demo Mode Methods
  // ============================================================================

  /**
   * Get remaining message count in demo mode
   */
  async getDemoMessagesRemaining(): Promise<string> {
    return (await this.demoMessageCount.textContent()) || '';
  }

  /**
   * Check if signup modal is visible
   */
  async isSignupModalVisible(): Promise<boolean> {
    return await this.signupModal.isVisible();
  }

  /**
   * Close signup modal
   */
  async closeSignupModal() {
    const closeButton = this.signupModal.locator('[data-testid="close-modal"]');
    await closeButton.click();
    await this.signupModal.waitFor({ state: 'hidden' });
  }

  // ============================================================================
  // Voice Mode Methods
  // ============================================================================

  /**
   * Toggle voice mode
   */
  async toggleVoiceMode() {
    await this.voiceModeToggle.click();
  }

  /**
   * Get live transcription text
   */
  async getLiveTranscription(): Promise<string> {
    return (await this.liveTranscription.textContent()) || '';
  }

  /**
   * Check if TTS is playing
   */
  async isTTSPlaying(): Promise<boolean> {
    return await this.ttsIndicator.isVisible();
  }

  // ============================================================================
  // Group Chat Methods
  // ============================================================================

  /**
   * Get all participant names displayed in the chat
   */
  async getParticipantNames(): Promise<string[]> {
    const participants = this.page.locator('[data-testid="participant-name"]');
    const names: string[] = [];
    const count = await participants.count();
    for (let i = 0; i < count; i++) {
      names.push((await participants.nth(i).textContent()) || '');
    }
    return names;
  }

  /**
   * Invite a friend to the chat
   */
  async inviteFriend(friendTestId: string) {
    await this.openFriendsPanel();
    const friendItem = this.friendsPanel.locator(`[data-testid="${friendTestId}"]`);
    await friendItem.click();
  }

  // ============================================================================
  // Assertion Helpers
  // ============================================================================

  /**
   * Assert that a user message was sent
   */
  async expectUserMessageSent(content: string) {
    await expect(this.userMessages.last()).toContainText(content);
  }

  /**
   * Assert that an assistant message was received
   */
  async expectAssistantMessageReceived(content: string, timeout = 10000) {
    await expect(this.assistantMessages.last()).toContainText(content, { timeout });
  }

  /**
   * Assert that the game board is visible
   */
  async expectGameBoardVisible() {
    await expect(this.gameBoard).toBeVisible();
  }

  /**
   * Assert that the gifts panel is visible
   */
  async expectGiftsPanelVisible() {
    await expect(this.giftsPanel).toBeVisible();
  }

  /**
   * Assert chat is in empty state
   */
  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible();
  }
}

/**
 * Create a ChatPage instance for the given Playwright page
 */
export function createChatPage(page: Page): ChatPage {
  return new ChatPage(page);
}
