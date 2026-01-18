/**
 * Influencer Page Helper
 * Page object model for interacting with influencer model admin pages
 */

import { Page, Locator, expect } from '@playwright/test';

export class InfluencerPage {
  private page: Page;

  // Locators
  readonly pageTitle: Locator;
  readonly trainNewModelButton: Locator;
  readonly modelList: Locator;
  readonly statsCards: Locator;
  readonly searchInput: Locator;
  readonly refreshButton: Locator;

  // Model detail page locators
  readonly promptTextarea: Locator;
  readonly negativePromptTextarea: Locator;
  readonly generateButton: Locator;
  readonly advancedSettingsToggle: Locator;
  readonly samplesGrid: Locator;
  readonly downloadLoraButton: Locator;
  readonly backButton: Locator;

  // Advanced settings locators
  readonly guidanceScaleSlider: Locator;
  readonly loraScaleSlider: Locator;
  readonly stepsSlider: Locator;
  readonly seedInput: Locator;
  readonly widthInput: Locator;
  readonly heightInput: Locator;

  constructor(page: Page) {
    this.page = page;

    // List page locators
    this.pageTitle = page.locator('h1');
    this.trainNewModelButton = page.locator('a:has-text("Train New Model")');
    this.modelList = page.locator('[class*="space-y-2"]');
    this.statsCards = page.locator('[class*="grid-cols-4"]');
    this.searchInput = page.locator('input[placeholder*="Search"]');
    this.refreshButton = page.locator('button:has-text("Refresh")');

    // Model detail page locators
    this.promptTextarea = page.locator('textarea#prompt');
    this.negativePromptTextarea = page.locator('textarea#negativePrompt');
    this.generateButton = page.locator('button:has-text("Generate Sample")');
    this.advancedSettingsToggle = page.locator('button:has-text("Advanced Settings")');
    this.samplesGrid = page.locator('[class*="grid-cols-3"]').last();
    this.downloadLoraButton = page.locator('button:has-text("Download LoRA")');
    this.backButton = page.locator('button:has-text("Back")');

    // Advanced settings locators
    this.guidanceScaleSlider = page.locator('[data-testid="guidance-scale-slider"]');
    this.loraScaleSlider = page.locator('[data-testid="lora-scale-slider"]');
    this.stepsSlider = page.locator('[data-testid="steps-slider"]');
    this.seedInput = page.locator('input#seed');
    this.widthInput = page.locator('input#width');
    this.heightInput = page.locator('input#height');
  }

  // Navigation
  async gotoList() {
    await this.page.goto('/admin/influencer');
    await expect(this.pageTitle).toContainText('Influencer Models');
  }

  async gotoModel(modelId: string, expectTitle = true) {
    await this.page.goto(`/admin/influencer/${modelId}`);
    await this.page.waitForLoadState('networkidle');
    if (expectTitle) {
      await expect(this.pageTitle).toBeVisible({ timeout: 10000 });
    }
  }

  async gotoCreate() {
    await this.page.goto('/admin/influencer/create');
    await expect(this.pageTitle).toContainText('Train New Model');
  }

  // List page actions
  async searchModels(query: string) {
    await this.searchInput.fill(query);
    // Debounce wait
    await this.page.waitForTimeout(300);
  }

  async clickModel(modelName: string) {
    await this.page.locator(`a:has-text("${modelName}")`).click();
  }

  async clickSamplesButton(modelName: string) {
    const modelRow = this.page.locator(`[class*="rounded-xl"]:has-text("${modelName}")`);
    await modelRow.locator('button:has-text("Samples")').click();
  }

  // Model detail page actions
  async fillPrompt(prompt: string) {
    await this.promptTextarea.fill(prompt);
  }

  async fillNegativePrompt(negativePrompt: string) {
    await this.negativePromptTextarea.fill(negativePrompt);
  }

  async openAdvancedSettings() {
    await this.advancedSettingsToggle.click();
    await this.page.waitForSelector('#seed'); // Wait for advanced panel to open
  }

  async setSeed(seed: string) {
    await this.seedInput.fill(seed);
  }

  async setWidth(width: string) {
    await this.widthInput.fill(width);
  }

  async setHeight(height: string) {
    await this.heightInput.fill(height);
  }

  async generateSample() {
    await this.generateButton.click();
  }

  async downloadLora() {
    await this.downloadLoraButton.click();
  }

  async goBack() {
    await this.backButton.click();
  }

  // Sample interactions
  async getSampleCards() {
    return this.samplesGrid.locator('[class*="rounded-xl"]');
  }

  async getSampleCount() {
    const cards = await this.getSampleCards();
    return cards.count();
  }

  async deleteSample(index: number) {
    const cards = await this.getSampleCards();
    const deleteButton = cards.nth(index).locator('button:has(svg[class*="trash"])');
    await deleteButton.click();
  }

  // Assertions
  async expectModelStatus(status: string) {
    await expect(this.page.locator(`text=${status}`).first()).toBeVisible();
  }

  async expectSampleStatus(index: number, status: string) {
    const cards = await this.getSampleCards();
    await expect(cards.nth(index).locator(`text=${status}`)).toBeVisible();
  }

  async expectEmptySamplesMessage() {
    await expect(this.page.locator('text=No samples generated yet')).toBeVisible();
  }

  async expectGenerateButtonDisabled() {
    await expect(this.generateButton).toBeDisabled();
  }

  async expectGenerateButtonEnabled() {
    await expect(this.generateButton).toBeEnabled();
  }

  async expectModelNotReadyMessage() {
    await expect(this.page.locator('text=Model Not Ready')).toBeVisible();
  }

  async expectStats(total: number, ready: number, training: number, failed: number) {
    // Check for stats card values using more specific locators
    await expect(this.page.locator('text=Total Models').locator('..').locator('div.text-2xl')).toContainText(total.toString());
    await expect(this.page.locator('text=Ready').first().locator('..').locator('div').first()).toContainText(ready.toString());
  }

  async waitForToast(text: string) {
    await expect(
      this.page.locator(`[class*="toast"], [role="alert"]`).filter({ hasText: text })
    ).toBeVisible({ timeout: 5000 });
  }

  async waitForSampleGeneration(timeout = 30000) {
    await expect(this.page.locator('text=Generating...')).toBeVisible({ timeout: 5000 });
    // Wait for generation to complete (either Completed or Failed)
    await expect(
      this.page.locator('text=Completed, text=Failed')
    ).toBeVisible({ timeout });
  }
}

export function createInfluencerPage(page: Page): InfluencerPage {
  return new InfluencerPage(page);
}
