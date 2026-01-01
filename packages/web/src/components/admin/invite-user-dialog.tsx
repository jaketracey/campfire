'use client';

import { useState } from 'react';
import { Mail, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { inviteUser } from '@/lib/api/admin';

interface InviteUserDialogProps {
  onInviteSent?: () => void;
}

export function InviteUserDialog({ onInviteSent }: InviteUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await inviteUser({
        email,
        message: message || undefined,
      });

      setInviteUrl(response.data.inviteUrl);
      onInviteSent?.();
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to send invite');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setOpen(false);
    // Reset form after close animation
    setTimeout(() => {
      setEmail('');
      setMessage('');
      setError(null);
      setInviteUrl(null);
      setCopied(false);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => isOpen ? setOpen(true) : handleClose()}>
      <DialogTrigger asChild>
        <Button className="bg-campfire-600 hover:bg-campfire-500 text-white">
          <Mail className="mr-2 h-4 w-4" />
          Invite User
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-zinc-950 border border-white/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Invite User</DialogTitle>
          <DialogDescription className="text-gray-400">
            Send an invitation email to a new user.
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <Check className="h-5 w-5 text-green-500" />
              <p className="text-green-500 text-sm">Invitation sent to {email}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-gray-400">Invite URL</Label>
              <div className="flex gap-2">
                <Input
                  value={inviteUrl}
                  readOnly
                  className="bg-white/5 border-white/10 text-white text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyUrl}
                  className="border-white/10 hover:bg-white/10"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                You can also share this link directly with the user.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-400">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-600"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message" className="text-gray-400">
                Personal Message (optional)
              </Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a personal note to the invitation..."
                rows={3}
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 resize-none"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-500 text-sm">{error}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="border-white/10 hover:bg-white/10 text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading}
                className="bg-campfire-600 hover:bg-campfire-500 text-white"
              >
                {isLoading ? 'Sending...' : 'Send Invitation'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {inviteUrl && (
          <DialogFooter>
            <Button
              onClick={handleClose}
              className="bg-campfire-600 hover:bg-campfire-500 text-white w-full"
            >
              Done
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
