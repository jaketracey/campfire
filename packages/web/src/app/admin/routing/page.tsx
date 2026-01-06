'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { GitBranch, Image, Video } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TextRoutingTab } from '@/components/admin/routing/text-routing-tab';
import { ImageRoutingTab } from '@/components/admin/routing/image-routing-tab';
import { VideoRoutingTab } from '@/components/admin/routing/video-routing-tab';

type RoutingKind = 'text' | 'image' | 'video';

const normalizeRoutingKind = (tab: string | null): RoutingKind => {
  if (tab === 'image' || tab === 'video' || tab === 'text') return tab;
  return 'text';
};

export default function RoutingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState<RoutingKind>(() => normalizeRoutingKind(tabParam));

  useEffect(() => {
    setActiveTab(normalizeRoutingKind(tabParam));
  }, [tabParam]);

  const onTabChange = (value: string) => {
    const nextTab = normalizeRoutingKind(value);
    setActiveTab(nextTab);

    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === 'text') params.delete('tab');
    else params.set('tab', nextTab);
    const query = params.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as Route);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Routing</h1>
        <p className="text-gray-400 text-sm mt-1">
          Configure model routing for text, image, and video use cases
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 bg-white/5">
          <TabsTrigger value="text" className="gap-2">
            <GitBranch className="h-4 w-4" />
            Text
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300">AI</Badge>
          </TabsTrigger>
          <TabsTrigger value="image" className="gap-2">
            <Image className="h-4 w-4" />
            Image
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300">Gen</Badge>
          </TabsTrigger>
          <TabsTrigger value="video" className="gap-2">
            <Video className="h-4 w-4" />
            Video
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300">Gen</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <TextRoutingTab />
        </TabsContent>
        <TabsContent value="image">
          <ImageRoutingTab />
        </TabsContent>
        <TabsContent value="video">
          <VideoRoutingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

