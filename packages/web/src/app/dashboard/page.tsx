'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MessageCircle, Plus, Sparkles, User } from 'lucide-react';

interface Companion {
  id: string;
  name: string;
  archetype: string;
  avatarStyle: string;
  createdAt: string;
}

interface Session {
  id: string;
  companionId: string;
  companionName: string;
  lastMessage: string;
  updatedAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch companions and sessions from API
    // For now, show empty state
    setLoading(false);
  }, []);

  const handleStartChat = (companionId: string) => {
    // TODO: Create new session via API and navigate to it
    router.push(`/chat/new?companion=${companionId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const hasCompanions = companions.length > 0;
  const hasSessions = sessions.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      <div className="container max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Manage your companions and conversations</p>
          </div>
          <Button onClick={() => router.push('/onboard')} size="lg">
            <Plus className="mr-2 h-5 w-5" />
            New Companion
          </Button>
        </div>

        {/* Empty State - No companions yet */}
        {!hasCompanions && (
          <Card className="bg-background/60 backdrop-blur-xl border-primary/20 mb-8">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <Sparkles className="h-10 w-10 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Welcome to Campfire</h2>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                Create your first AI companion to start having meaningful conversations.
                Customize their personality, voice, and appearance.
              </p>
              <Button onClick={() => router.push('/onboard')} size="lg">
                <Plus className="mr-2 h-5 w-5" />
                Create Your First Companion
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Companions Section */}
        {hasCompanions && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Your Companions</h2>
              <Button variant="outline" size="sm" onClick={() => router.push('/onboard')}>
                <Plus className="mr-2 h-4 w-4" />
                Add New
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {companions.map((companion) => (
                <Card
                  key={companion.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors group"
                  onClick={() => handleStartChat(companion.id)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 rounded-full bg-primary/20 flex items-center justify-center">
                        <User className="h-7 w-7 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg">{companion.name}</h3>
                        <p className="text-sm text-muted-foreground capitalize">{companion.archetype}</p>
                      </div>
                    </div>
                    <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" className="w-full">
                        <MessageCircle className="mr-2 h-4 w-4" />
                        Start Chat
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Recent Conversations Section */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Recent Conversations</h2>
          {!hasSessions ? (
            <Card className="bg-background/60 backdrop-blur-xl border-primary/20">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <MessageCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No conversations yet</h3>
                <p className="text-muted-foreground text-center mb-4">
                  {hasCompanions
                    ? 'Start a chat with one of your companions above'
                    : 'Create a companion to begin chatting'}
                </p>
                {!hasCompanions && (
                  <Button variant="outline" onClick={() => router.push('/onboard')}>
                    Create Companion
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <Card
                  key={session.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => router.push(`/chat/${session.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                        <MessageCircle className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">{session.companionName}</h3>
                          <span className="text-xs text-muted-foreground">
                            {new Date(session.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{session.lastMessage}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
