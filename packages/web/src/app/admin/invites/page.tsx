'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, Mail, Trash2, Copy, Check } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { InviteUserDialog } from '@/components/admin/invite-user-dialog';
import { listPendingInvites, revokePendingInvite, type AdminInvite } from '@/lib/api/admin';
import { formatDistanceToNow, format, isPast } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 20;

export default function AdminInvitesPage() {
  const { toast } = useToast();
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [revokeDialog, setRevokeDialog] = useState<AdminInvite | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await listPendingInvites({
        limit: PAGE_SIZE,
        offset,
      });
      setInvites(response.data.invites);
      setHasMore(response.data.hasMore);
    } catch (error) {
      console.error('Failed to fetch invites:', error);
      toast({
        title: 'Error',
        description: 'Failed to load invites',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [offset, toast]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleRevoke = async () => {
    if (!revokeDialog) return;

    try {
      await revokePendingInvite(revokeDialog.id);
      toast({
        title: 'Invite Revoked',
        description: `Invitation for ${revokeDialog.email} has been revoked.`,
      });
      fetchInvites();
    } catch (error) {
      console.error('Failed to revoke invite:', error);
      toast({
        title: 'Error',
        description: 'Failed to revoke invitation',
        variant: 'destructive',
      });
    } finally {
      setRevokeDialog(null);
    }
  };

  const copyInviteUrl = async (inviteId: string) => {
    const url = `${window.location.origin}/signup?invite=${inviteId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(inviteId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - PAGE_SIZE));
  };

  const handleNextPage = () => {
    if (hasMore) {
      setOffset(offset + PAGE_SIZE);
    }
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const getStatusBadge = (invite: AdminInvite) => {
    if (invite.acceptedAt) {
      return <Badge className="bg-green-500/20 text-green-400 border-0">Accepted</Badge>;
    }
    if (isPast(new Date(invite.expiresAt))) {
      return <Badge className="bg-gray-500/20 text-gray-400 border-0">Expired</Badge>;
    }
    if (invite.status === 'revoked') {
      return <Badge className="bg-red-500/20 text-red-400 border-0">Revoked</Badge>;
    }
    return <Badge className="bg-amber-500/20 text-amber-400 border-0">Pending</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-white">Invitations</h1>
          <p className="text-gray-400 mt-1">Manage pending user invitations</p>
        </div>
        <InviteUserDialog onInviteSent={fetchInvites} />
      </div>

      {/* Main Card */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-400">
              <Mail className="h-4 w-4" />
              <span className="text-sm">
                {invites.length} invitation{invites.length !== 1 ? 's' : ''}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchInvites}
              disabled={isLoading}
              className="border-white/10 hover:bg-white/10"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-pulse text-gray-500">Loading invites...</div>
            </div>
          ) : invites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Mail className="h-12 w-12 mb-4 opacity-50" />
              <p>No pending invitations</p>
              <p className="text-sm mt-1">Invite users to get started</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-gray-500">Email</TableHead>
                  <TableHead className="text-gray-500">Status</TableHead>
                  <TableHead className="text-gray-500">Invited</TableHead>
                  <TableHead className="text-gray-500">Expires</TableHead>
                  <TableHead className="text-gray-500 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id} className="border-white/5 hover:bg-white/[0.02]">
                    <TableCell className="font-medium text-white">
                      {invite.email}
                      {invite.message && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                          {invite.message}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(invite)}</TableCell>
                    <TableCell className="text-gray-400 text-sm">
                      {formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-gray-400 text-sm">
                      {isPast(new Date(invite.expiresAt)) ? (
                        <span className="text-gray-600">Expired</span>
                      ) : (
                        format(new Date(invite.expiresAt), 'MMM d, yyyy')
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!invite.acceptedAt && invite.status !== 'revoked' && !isPast(new Date(invite.expiresAt)) && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyInviteUrl(invite.id)}
                              className="h-8 w-8 text-gray-400 hover:text-white"
                            >
                              {copiedId === invite.id ? (
                                <Check className="h-4 w-4 text-green-400" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRevokeDialog(invite)}
                              className="h-8 w-8 text-gray-400 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Pagination */}
        {!isLoading && invites.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
            <p className="text-sm text-gray-500">
              Page {currentPage}
              {hasMore ? '+' : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={offset === 0}
                className="border-white/10 hover:bg-white/10"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!hasMore}
                className="border-white/10 hover:bg-white/10"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={!!revokeDialog} onOpenChange={() => setRevokeDialog(null)}>
        <AlertDialogContent className="bg-gray-900 border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Revoke Invitation?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This will revoke the invitation for <strong>{revokeDialog?.email}</strong>.
              They will no longer be able to use this invite link to sign up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 hover:bg-white/10">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-red-600 hover:bg-red-700"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
