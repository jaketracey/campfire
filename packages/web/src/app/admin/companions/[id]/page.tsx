'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, MessageSquare, DollarSign, Cpu, Image as ImageIcon, Network, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CompanionImageGallery } from '@/components/admin/companion-image-gallery';
import { KnowledgeGraphViewer } from '@/components/admin/knowledge-graph-viewer';
import { getAdminCompanion, type AdminCompanionDetail, type CompanionStatus } from '@/lib/api/admin-companions';

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function StatusBadge({ status }: { status: CompanionStatus }) {
  const variants: Record<CompanionStatus, { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
    active: { label: 'Active', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
    archived: { label: 'Archived', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  };

  const variant = variants[status];

  return (
    <Badge variant="outline" className={`${variant.className} text-sm`}>
      {variant.label}
    </Badge>
  );
}

interface StatCardProps {
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
  subValue?: string;
}

function StatCard({ icon: Icon, label, value, subValue }: StatCardProps) {
  return (
    <Card className="bg-white/[0.02] border-white/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/5">
            <Icon className="h-5 w-5 text-campfire-400" />
          </div>
          <div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-bold text-white">{value}</p>
            {subValue && <p className="text-xs text-gray-500">{subValue}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminCompanionDetailPage() {
  const params = useParams();
  const companionId = params.id as string;
  const [companion, setCompanion] = useState<AdminCompanionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanion = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getAdminCompanion(companionId);
      setCompanion(response.data);
    } catch (err) {
      console.error('Failed to fetch companion:', err);
      setError('Failed to load companion details');
    } finally {
      setIsLoading(false);
    }
  }, [companionId]);

  useEffect(() => {
    fetchCompanion();
  }, [fetchCompanion]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-campfire-500" />
      </div>
    );
  }

  if (error || !companion) {
    return (
      <div className="space-y-6">
        <Link href={'/admin/companions' as Route}>
          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Companions
          </Button>
        </Link>
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="py-12 text-center">
            <p className="text-red-400">{error || 'Companion not found'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const backstory = companion.backstory || 'No backstory available';
  const totalTokens = companion.totalTokensInput + companion.totalTokensOutput;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Link href={'/admin/companions' as Route}>
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <Avatar className="h-16 w-16">
            {companion.avatarUrl ? (
              <AvatarImage
                src={companion.avatarUrl}
                alt={companion.name}
                className="object-cover"
              />
            ) : null}
            <AvatarFallback className="bg-campfire-500/10 text-campfire-500 text-xl font-medium">
              {companion.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-display text-white">{companion.name}</h1>
              <StatusBadge status={companion.status} />
            </div>
            <p className="text-gray-400 text-sm mt-1">
              Owner:{' '}
              <Link
                href={`/admin/users?search=${encodeURIComponent(companion.ownerEmail)}` as Route}
                className="text-campfire-400 hover:underline"
              >
                {companion.ownerEmail}
              </Link>
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              Created {formatDistanceToNow(new Date(companion.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={MessageSquare}
          label="Sessions"
          value={formatNumber(companion.sessionCount)}
        />
        <StatCard
          icon={MessageSquare}
          label="Messages"
          value={formatNumber(companion.totalMessages)}
        />
        <StatCard
          icon={DollarSign}
          label="Total Cost"
          value={formatCurrency(companion.totalCostUsd)}
        />
        <StatCard
          icon={Cpu}
          label="Tokens"
          value={formatNumber(totalTokens)}
          subValue={`${formatNumber(companion.totalTokensInput)} in / ${formatNumber(companion.totalTokensOutput)} out`}
        />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Backstory */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="border-b border-white/5">
            <CardTitle className="text-lg font-medium text-white">Backstory</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">
              {backstory}
            </p>
          </CardContent>
        </Card>

        {/* Image Gallery */}
        <Card className="bg-white/[0.02] border-white/5">
          <CardHeader className="border-b border-white/5">
            <CardTitle className="text-lg font-medium text-white flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-campfire-400" />
              Image Gallery
              <Badge variant="outline" className="ml-auto bg-white/5 border-white/10">
                {companion.imageCount} images
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <CompanionImageGallery companionId={companionId} />
          </CardContent>
        </Card>
      </div>

      {/* Knowledge Graph */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="border-b border-white/5">
          <CardTitle className="text-lg font-medium text-white flex items-center gap-2">
            <Network className="h-5 w-5 text-campfire-400" />
            Knowledge Graph
            <Badge variant="outline" className="ml-auto bg-white/5 border-white/10">
              {companion.entityCount} entities
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <KnowledgeGraphViewer companionId={companionId} />
        </CardContent>
      </Card>
    </div>
  );
}
