'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/use-auth';
import { createSession } from '@/lib/api';

/**
 * New Chat Session Page
 * Creates a new session and redirects to the chat page with the session ID.
 * Expects a `companion` query parameter with the companion ID.
 */
export default function NewChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading: authLoading } = useRequireAuth('/login');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const companionId = searchParams.get('companion');

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    if (!companionId) {
      setError('No companion specified');
      return;
    }

    if (isCreating) return;

    async function createNewSession() {
      setIsCreating(true);
      try {
        const session = await createSession({ companionId: companionId! });
        // Redirect to the actual chat session
        router.replace(`/chat/${session.id}`);
      } catch (err) {
        console.error('Failed to create session:', err);
        setError(err instanceof Error ? err.message : 'Failed to create session');
        setIsCreating(false);
      }
    }

    createNewSession();
  }, [companionId, authLoading, isAuthenticated, router, isCreating]);

  // Show loading while checking auth or creating session
  if (authLoading || isCreating) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">
            {authLoading ? 'Loading...' : 'Creating session...'}
          </p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="text-primary hover:underline"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return null;
}
