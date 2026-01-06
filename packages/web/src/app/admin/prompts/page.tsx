'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { GitBranch, Image, Video } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PromptTemplatesPanel } from '@/components/admin/prompt-templates/prompt-templates-panel';

type PromptKind = 'text' | 'image' | 'video';

const normalizePromptKind = (tab: string | null): PromptKind => {
  if (tab === 'image' || tab === 'video' || tab === 'text') return tab;
  return 'text';
};

const ROUTING_HREFS: Record<PromptKind, Route> = {
  text: '/admin/routing' as Route,
  image: '/admin/routing?tab=image' as Route,
  video: '/admin/routing?tab=video' as Route,
};

export default function PromptsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState<PromptKind>(() => normalizePromptKind(tabParam));

  useEffect(() => {
    setActiveTab(normalizePromptKind(tabParam));
  }, [tabParam]);

  const onTabChange = (value: string) => {
    const nextTab = normalizePromptKind(value);
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
        <h1 className="text-2xl font-bold text-white">Prompts</h1>
        <p className="text-gray-400 text-sm mt-1">
          Configure routing prompt templates for text, image, and video
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 gap-1 md:gap-2 bg-white/5 border border-white/10 h-12 md:h-14 p-1">
          <TabsTrigger
            value="text"
            className="gap-2 md:gap-3 px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base data-[state=inactive]:hover:bg-white/5 data-[state=inactive]:hover:text-white"
          >
            <GitBranch className="h-5 w-5 md:h-6 md:w-6" />
            Text
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300 text-xs md:text-sm">AI</Badge>
          </TabsTrigger>
          <TabsTrigger
            value="image"
            className="gap-2 md:gap-3 px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base data-[state=inactive]:hover:bg-white/5 data-[state=inactive]:hover:text-white"
          >
            <Image className="h-5 w-5 md:h-6 md:w-6" />
            Image
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300 text-xs md:text-sm">Gen</Badge>
          </TabsTrigger>
          <TabsTrigger
            value="video"
            className="gap-2 md:gap-3 px-4 py-2 md:px-6 md:py-2.5 text-sm md:text-base data-[state=inactive]:hover:bg-white/5 data-[state=inactive]:hover:text-white"
          >
            <Video className="h-5 w-5 md:h-6 md:w-6" />
            Video
            <Badge variant="secondary" className="ml-1 bg-white/10 text-gray-300 text-xs md:text-sm">Gen</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <PromptTemplatesPanel adminArea="routing" title="Text Routing Prompts" />
        </TabsContent>
        <TabsContent value="image">
          <PromptTemplatesPanel adminArea="image_routing" title="Image Routing Prompts" />
        </TabsContent>
        <TabsContent value="video">
          <PromptTemplatesPanel adminArea="video_routing" title="Video Routing Prompts" />
        </TabsContent>
      </Tabs>

      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href={ROUTING_HREFS.text}>
                <GitBranch className="h-4 w-4" />
                Text Routing
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href={ROUTING_HREFS.image}>
                <Image className="h-4 w-4" />
                Image Routing
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href={ROUTING_HREFS.video}>
                <Video className="h-4 w-4" />
                Video Routing
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
