'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MessageCircle, Plus } from 'lucide-react';

interface Session {
  id: string;
  companionId: string;
  companionName: string;
  lastMessage: string;
  updatedAt: string;
}

export default function ChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch sessions from API
    // For now, show empty state
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Conversations</h1>
        <Button onClick={() => router.push('/onboard')}>
          <Plus className="mr-2 h-4 w-4" />
          New Companion
        </Button>
      </div>

      {sessions.length === 0 ? (
        <Card className="bg-background/60 backdrop-blur-xl border-primary/20">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MessageCircle className="h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No conversations yet</h2>
            <p className="text-muted-foreground mb-6">Create your first AI companion to start chatting</p>
            <Button onClick={() => router.push('/onboard')}>
              Create Companion
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <Card
              key={session.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => router.push(`/chat/${session.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                    <MessageCircle className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{session.companionName}</h3>
                    <p className="text-sm text-muted-foreground truncate">{session.lastMessage}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
