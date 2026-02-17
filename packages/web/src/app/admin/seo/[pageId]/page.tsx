'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  ArrowLeft,
  RefreshCw,
  Save,
  Sparkles,
  Globe,
  FileText,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getSeoPage,
  updateSeoPage,
  regenerateSeoPage,
  publishSeoPage,
  unpublishSeoPage,
  type SeoPage,
  type SeoPageStatus,
} from '@/lib/api/admin-seo';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitize-html';

const STATUS_LABELS: Record<SeoPageStatus, string> = {
  draft: 'Draft',
  generating: 'Generating',
  published: 'Published',
  archived: 'Archived',
};

function getStatusBadgeClasses(status: SeoPageStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-500/20 text-gray-400 border-0';
    case 'generating':
      return 'bg-blue-500/20 text-blue-400 border-0 animate-pulse';
    case 'published':
      return 'bg-green-500/20 text-green-400 border-0';
    case 'archived':
      return 'bg-amber-500/20 text-amber-400 border-0';
    default:
      return 'bg-gray-500/20 text-gray-400 border-0';
  }
}

export default function AdminSeoEditPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const pageId = params.pageId as string;

  const [page, setPage] = useState<SeoPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Editable fields
  const [title, setTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImageUrl, setOgImageUrl] = useState('');

  const fetchPage = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getSeoPage(pageId);
      setPage(data);
      setTitle(data.title);
      setMetaDescription(data.metaDescription ?? '');
      setOgTitle(data.ogTitle ?? '');
      setOgDescription(data.ogDescription ?? '');
      setOgImageUrl(data.ogImageUrl ?? '');
    } catch (error) {
      console.error('Failed to fetch page:', error);
      toast({
        title: 'Error',
        description: 'Failed to load SEO page',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [pageId, toast]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Polling for generating status
  useEffect(() => {
    if (page?.status === 'generating') {
      const interval = setInterval(fetchPage, 3000);
      return () => clearInterval(interval);
    }
  }, [page?.status, fetchPage]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSeoPage(pageId, {
        title,
        metaDescription: metaDescription || undefined,
        ogTitle: ogTitle || undefined,
        ogDescription: ogDescription || undefined,
        ogImageUrl: ogImageUrl || null,
      });
      toast({
        title: 'Saved',
        description: 'SEO page metadata updated successfully.',
      });
      fetchPage();
    } catch (error) {
      console.error('Failed to save:', error);
      toast({
        title: 'Error',
        description: 'Failed to save changes',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await regenerateSeoPage(pageId);
      toast({
        title: 'Regeneration Started',
        description: 'AI is generating new content.',
      });
      fetchPage();
    } catch (error) {
      console.error('Failed to regenerate:', error);
      toast({
        title: 'Error',
        description: 'Failed to start regeneration',
        variant: 'destructive',
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handlePublish = async () => {
    try {
      await publishSeoPage(pageId);
      toast({
        title: 'Page Published',
        description: 'The page is now live.',
      });
      fetchPage();
    } catch (error) {
      console.error('Failed to publish:', error);
      toast({
        title: 'Error',
        description: 'Failed to publish page',
        variant: 'destructive',
      });
    }
  };

  const handleUnpublish = async () => {
    try {
      await unpublishSeoPage(pageId);
      toast({
        title: 'Page Unpublished',
        description: 'The page has been reverted to draft.',
      });
      fetchPage();
    } catch (error) {
      console.error('Failed to unpublish:', error);
      toast({
        title: 'Error',
        description: 'Failed to unpublish page',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <p>SEO page not found</p>
        <Button
          variant="link"
          onClick={() => router.push('/admin/seo' as Route)}
          className="mt-2"
        >
          Back to SEO Pages
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/admin/seo' as Route)}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={page.companionAvatarUrl ?? undefined} />
              <AvatarFallback className="bg-campfire-500/20 text-campfire-400">
                {page.companionName?.charAt(0) ?? '?'}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold font-display text-white">
                {page.companionName}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <code className="bg-white/5 px-2 py-0.5 rounded">/c/{page.slug}</code>
                <Badge className={getStatusBadgeClasses(page.status)}>
                  {STATUS_LABELS[page.status]}
                </Badge>
                <span>v{page.version}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {page.status === 'published' && (
            <Button
              variant="outline"
              onClick={() => window.open(`/c/${page.slug}`, '_blank')}
              className="border-white/10"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View Live
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleRegenerate}
            disabled={page.status === 'generating' || isRegenerating}
            className="border-white/10"
          >
            <Sparkles className={cn('h-4 w-4 mr-2', isRegenerating && 'animate-pulse')} />
            Regenerate
          </Button>
          {page.status === 'draft' && (
            <Button onClick={handlePublish} className="bg-green-600 hover:bg-green-700">
              <Globe className="h-4 w-4 mr-2" />
              Publish
            </Button>
          )}
          {page.status === 'published' && (
            <Button
              variant="outline"
              onClick={handleUnpublish}
              className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
            >
              <FileText className="h-4 w-4 mr-2" />
              Unpublish
            </Button>
          )}
        </div>
      </div>

      {/* Generation Error */}
      {page.generationError && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="py-3">
            <p className="text-red-400 text-sm">
              <strong>Generation Error:</strong> {page.generationError}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="metadata" className="space-y-4">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="metadata" className="data-[state=active]:bg-white/10">
            Metadata
          </TabsTrigger>
          <TabsTrigger value="preview" className="data-[state=active]:bg-white/10">
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </TabsTrigger>
        </TabsList>

        {/* Metadata Tab */}
        <TabsContent value="metadata" className="space-y-4">
          <Card className="bg-white/[0.02] border-white/5">
            <CardHeader>
              <CardTitle className="text-white text-lg">SEO Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Page Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                  placeholder="Page title for search results"
                />
                <p className="text-xs text-gray-500">{title.length}/200 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="metaDescription">Meta Description</Label>
                <Textarea
                  id="metaDescription"
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  className="bg-white/5 border-white/10 text-white resize-none"
                  rows={3}
                  placeholder="Description shown in search results"
                />
                <p className="text-xs text-gray-500">{metaDescription.length}/320 characters</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ogTitle">OG Title</Label>
                  <Input
                    id="ogTitle"
                    value={ogTitle}
                    onChange={(e) => setOgTitle(e.target.value)}
                    className="bg-white/5 border-white/10 text-white"
                    placeholder="Title for social sharing"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ogDescription">OG Description</Label>
                  <Input
                    id="ogDescription"
                    value={ogDescription}
                    onChange={(e) => setOgDescription(e.target.value)}
                    className="bg-white/5 border-white/10 text-white"
                    placeholder="Description for social sharing"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ogImageUrl">OG Image URL</Label>
                <Input
                  id="ogImageUrl"
                  value={ogImageUrl}
                  onChange={(e) => setOgImageUrl(e.target.value)}
                  className="bg-white/5 border-white/10 text-white"
                  placeholder="https://..."
                />
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-campfire-500 hover:bg-campfire-600"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Info */}
          <Card className="bg-white/[0.02] border-white/5">
            <CardHeader>
              <CardTitle className="text-white text-lg">Page Info</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-gray-500">Created</dt>
                  <dd className="text-white">{format(new Date(page.createdAt), 'PPpp')}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Last Updated</dt>
                  <dd className="text-white">{format(new Date(page.updatedAt), 'PPpp')}</dd>
                </div>
                {page.publishedAt && (
                  <div>
                    <dt className="text-gray-500">Published</dt>
                    <dd className="text-white">{format(new Date(page.publishedAt), 'PPpp')}</dd>
                  </div>
                )}
                {page.generatedByModel && (
                  <div>
                    <dt className="text-gray-500">Generated By</dt>
                    <dd className="text-white">{page.generatedByModel}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview">
          <Card className="bg-white/[0.02] border-white/5">
            <CardHeader>
              <CardTitle className="text-white text-lg">Content Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {page.status === 'generating' ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <RefreshCw className="h-8 w-8 animate-spin mb-4" />
                  <p>Generating content...</p>
                </div>
              ) : !page.contentHtml ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <FileText className="h-8 w-8 mb-4 opacity-50" />
                  <p>No content generated yet</p>
                  <Button
                    variant="outline"
                    onClick={handleRegenerate}
                    className="mt-4 border-white/10"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Content
                  </Button>
                </div>
              ) : (
                <div className="bg-white rounded-lg p-6">
                  <div
                    className="prose prose-lg max-w-none"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.contentHtml) }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content JSON */}
          {page.contentJson && Object.keys(page.contentJson).length > 0 && (
            <Card className="bg-white/[0.02] border-white/5 mt-4">
              <CardHeader>
                <CardTitle className="text-white text-lg">Structured Content</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  {page.contentJson.headline && (
                    <div>
                      <dt className="text-gray-500 text-sm">Headline</dt>
                      <dd className="text-white text-lg font-semibold">{page.contentJson.headline}</dd>
                    </div>
                  )}
                  {page.contentJson.tagline && (
                    <div>
                      <dt className="text-gray-500 text-sm">Tagline</dt>
                      <dd className="text-gray-300">{page.contentJson.tagline}</dd>
                    </div>
                  )}
                  {page.contentJson.personalitySummary && (
                    <div>
                      <dt className="text-gray-500 text-sm">Personality Summary</dt>
                      <dd className="text-gray-300">{page.contentJson.personalitySummary}</dd>
                    </div>
                  )}
                  {page.contentJson.keyTraits && page.contentJson.keyTraits.length > 0 && (
                    <div>
                      <dt className="text-gray-500 text-sm mb-2">Key Traits</dt>
                      <dd className="flex flex-wrap gap-2">
                        {page.contentJson.keyTraits.map((trait, i) => (
                          <Badge key={i} className="bg-campfire-500/20 text-campfire-400 border-0">
                            {trait}
                          </Badge>
                        ))}
                      </dd>
                    </div>
                  )}
                  {page.contentJson.conversationStarters && page.contentJson.conversationStarters.length > 0 && (
                    <div>
                      <dt className="text-gray-500 text-sm mb-2">Conversation Starters</dt>
                      <dd className="space-y-2">
                        {page.contentJson.conversationStarters.map((starter, i) => (
                          <div key={i} className="text-gray-300 bg-white/5 rounded-lg p-3">
                            &ldquo;{starter}&rdquo;
                          </div>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
