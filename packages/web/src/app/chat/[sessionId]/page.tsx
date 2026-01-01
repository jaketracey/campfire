import { Suspense } from 'react';
import { ChatSessionContent } from './chat-session-content';

interface ChatSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

function ChatSessionLoading() {
  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b px-4 py-3 flex items-center gap-4">
        <div className="h-10 w-10 rounded-md bg-muted animate-pulse" />
        <div className="space-y-2">
          <div className="h-5 w-32 bg-muted animate-pulse rounded" />
          <div className="h-3 w-24 bg-muted animate-pulse rounded" />
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading chat session...</div>
      </div>
    </div>
  );
}

export default async function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { sessionId } = await params;

  return (
    <Suspense fallback={<ChatSessionLoading />}>
      <ChatSessionContent sessionId={sessionId} />
    </Suspense>
  );
}
