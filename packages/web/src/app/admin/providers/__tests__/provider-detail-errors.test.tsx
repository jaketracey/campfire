import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ProviderDetailPage from '../[providerId]/page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({ providerId: 'provider-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

vi.mock('@/lib/api/providers', () => ({
  getProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProviderConnection: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn(),
}));

import * as providersApi from '@/lib/api/providers';

const mockProvider: providersApi.ProviderWithModels = {
  id: 'provider-1',
  provider: 'openai',
  displayName: 'OpenAI',
  isEnabled: true,
  hasApiKey: true,
  apiBaseUrl: null,
  rateLimitRpm: null,
  rateLimitTpm: null,
  maxConcurrentRequests: 10,
  priority: 0,
  metadata: {},
  models: [
    {
      id: 'model-1',
      providerConfigId: 'provider-1',
      modelId: 'gpt-4o',
      displayName: 'GPT-4o',
      isEnabled: true,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputCostPerMillion: 2.5,
      outputCostPerMillion: 10,
      capabilities: ['chat', 'streaming'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('ProviderDetailPage model error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(providersApi.getProvider).mockResolvedValue(mockProvider);
  });

  it('shows error when saving a model fails', async () => {
    vi.mocked(providersApi.updateModel).mockRejectedValueOnce(
      new Error('Model validation failed: duplicate model ID')
    );

    const user = userEvent.setup();
    render(<ProviderDetailPage />);

    await waitFor(() => expect(providersApi.getProvider).toHaveBeenCalled());

    // Click Edit on existing model to open dialog
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    // Click Update to trigger save
    await user.click(screen.getByRole('button', { name: 'Update' }));

    // Error should appear inside the dialog
    await waitFor(() => {
      expect(screen.getByText('Model validation failed: duplicate model ID')).toBeInTheDocument();
    });
  });

  it('shows error when creating a model fails', async () => {
    vi.mocked(providersApi.createModel).mockRejectedValueOnce(
      new Error('Invalid model configuration')
    );

    const user = userEvent.setup();
    render(<ProviderDetailPage />);

    await waitFor(() => expect(providersApi.getProvider).toHaveBeenCalled());

    // Click Add Model to open dialog
    await user.click(screen.getByRole('button', { name: /Add Model/i }));

    // Fill required fields inside the dialog
    const modelIdInput = screen.getByPlaceholderText('e.g., gpt-4o, claude-3-opus');
    await user.type(modelIdInput, 'new-model');
    const modelDisplayNameInput = screen.getByPlaceholderText('e.g., GPT-4o, Claude 3 Opus');
    await user.type(modelDisplayNameInput, 'New Model');

    // Click Create
    await user.click(screen.getByRole('button', { name: 'Create' }));

    // Error should appear inside the dialog
    await waitFor(() => {
      expect(screen.getByText('Invalid model configuration')).toBeInTheDocument();
    });
  });

  it('shows error when deleting a model fails', async () => {
    vi.mocked(providersApi.deleteModel).mockRejectedValueOnce(
      new Error('Cannot delete model with active routing rules')
    );

    const user = userEvent.setup();
    render(<ProviderDetailPage />);

    await waitFor(() => expect(providersApi.getProvider).toHaveBeenCalled());

    // Click the delete button (trash icon) on the model row
    const deleteButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('svg.lucide-trash2') || btn.querySelector('[class*="trash"]')
    );
    // The first trash button triggers the AlertDialog for the model
    // We need to find the one associated with the model, not the provider delete
    const modelDeleteTrigger = screen.getAllByRole('button').find(
      (btn) => btn.classList.contains('text-red-400') || btn.className.includes('text-red-400')
    );

    if (modelDeleteTrigger) {
      await user.click(modelDeleteTrigger);
    } else {
      // Fallback: find by the Trash2 icon within the model actions area
      const trashButtons = document.querySelectorAll('button.text-red-400');
      if (trashButtons.length > 0) {
        await user.click(trashButtons[0] as HTMLElement);
      }
    }

    // Confirm deletion in the AlertDialog
    const confirmButton = await screen.findByRole('button', { name: 'Delete' });
    // There may be multiple Delete buttons (provider delete + model delete dialog)
    // The AlertDialog one should be visible
    const alertDialogActions = screen.getAllByRole('button', { name: 'Delete' });
    const modelDeleteConfirm = alertDialogActions.find(
      (btn) => btn.closest('[role="alertdialog"]')
    );
    if (modelDeleteConfirm) {
      await user.click(modelDeleteConfirm);
    }

    // Error should appear outside the dialog (model error banner)
    await waitFor(() => {
      expect(screen.getByText('Cannot delete model with active routing rules')).toBeInTheDocument();
    });
  });

  it('clears model error when opening model dialog', async () => {
    // First, trigger a delete error to set modelError
    vi.mocked(providersApi.deleteModel).mockRejectedValueOnce(
      new Error('Delete failed')
    );

    const user = userEvent.setup();
    render(<ProviderDetailPage />);

    await waitFor(() => expect(providersApi.getProvider).toHaveBeenCalled());

    // Trigger delete error
    const modelDeleteTrigger = document.querySelector('button.text-red-400') as HTMLElement;
    if (modelDeleteTrigger) {
      await user.click(modelDeleteTrigger);
      const alertDialogActions = screen.getAllByRole('button', { name: 'Delete' });
      const modelDeleteConfirm = alertDialogActions.find(
        (btn) => btn.closest('[role="alertdialog"]')
      );
      if (modelDeleteConfirm) {
        await user.click(modelDeleteConfirm);
      }
    }

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    // Now open the model dialog - error should be cleared
    await user.click(screen.getByRole('button', { name: /Add Model/i }));

    await waitFor(() => {
      expect(screen.queryByText('Delete failed')).not.toBeInTheDocument();
    });
  });

  it('shows fallback message for non-Error rejections on save', async () => {
    vi.mocked(providersApi.updateModel).mockRejectedValueOnce('string error');

    const user = userEvent.setup();
    render(<ProviderDetailPage />);

    await waitFor(() => expect(providersApi.getProvider).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to save model')).toBeInTheDocument();
    });
  });
});
