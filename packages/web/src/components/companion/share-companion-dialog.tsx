'use client';

import { useState } from 'react';
import { Share2, Copy, Check, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { updateCompanion } from '@/lib/api/companions';

interface ShareCompanionDialogProps {
  companionId: string;
  companionName: string;
  isPublic: boolean;
  onShareStatusChange?: (isPublic: boolean) => void;
  size?: 'sm' | 'default';
  /** User's referral code to include in share links for tracking */
  referralCode?: string;
}

export function ShareCompanionDialog({
  companionId,
  companionName,
  isPublic: initialIsPublic,
  onShareStatusChange,
  size = 'default',
  referralCode,
}: ShareCompanionDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [copied, setCopied] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Use marketing site URL for share links
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL || 'https://ignite.cam';
  // Include referral code in share URL for tracking
  const shareUrl = referralCode
    ? `${marketingUrl}/c/${companionId}?ref=${encodeURIComponent(referralCode)}`
    : `${marketingUrl}/c/${companionId}`;

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTogglePublic = async (checked: boolean) => {
    setIsUpdating(true);
    try {
      await updateCompanion(companionId, { isPublic: checked });
      setIsPublic(checked);
      onShareStatusChange?.(checked);
    } catch (error) {
      console.error('Failed to update share status:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleShareTwitter = () => {
    const text = encodeURIComponent(`Check out ${companionName}, my AI companion on Ignite!`);
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
  };

  const handleShareFacebook = () => {
    const url = encodeURIComponent(shareUrl);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className={
            size === 'sm'
              ? 'h-12 w-12 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white backdrop-blur-sm transition-all'
              : 'aspect-square h-12 md:h-14 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/10 hover:border-white/20 text-gray-400 hover:text-white transition-all'
          }
          title="Share companion"
        >
          <Share2 className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-zinc-950 border border-white/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Share {companionName}</DialogTitle>
          <DialogDescription className="text-gray-400">
            Make your companion public so others can see their profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Public Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-white">Public Profile</Label>
              <p className="text-xs text-gray-500">
                Allow anyone with the link to view this companion
              </p>
            </div>
            <Switch
              checked={isPublic}
              onCheckedChange={handleTogglePublic}
              disabled={isUpdating}
              className="data-[state=checked]:bg-campfire-600"
            />
          </div>

          {/* Share URL */}
          {isPublic && (
            <>
              <div className="space-y-2">
                <Label className="text-gray-400">Share Link</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                    <Input
                      value={shareUrl}
                      readOnly
                      className="pl-9 bg-white/5 border-white/10 text-white text-sm"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCopyLink}
                    className="border-white/10 hover:bg-white/10"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Social Share Buttons */}
              <div className="space-y-2">
                <Label className="text-gray-400">Share on Social</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleShareTwitter}
                    className="flex-1 border-white/10 hover:bg-white/10 text-white"
                  >
                    <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    Post on X
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleShareFacebook}
                    className="flex-1 border-white/10 hover:bg-white/10 text-white"
                  >
                    <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                    Share
                  </Button>
                </div>
              </div>
            </>
          )}

          {!isPublic && (
            <div className="p-4 rounded-lg bg-white/[0.02] border border-white/10">
              <p className="text-sm text-gray-400">
                Enable the public profile toggle above to get a shareable link for your companion.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
