'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw,
  Unlink,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  listAdAccounts,
  connectGoogleAds,
  connectFacebookAds,
  disconnectAdAccount,
  syncAdAccount,
  type AdAccount,
} from '@/lib/api/ads';

interface AccountsTabProps {
  refreshKey: number;
}

export function AccountsTab({ refreshKey }: AccountsTabProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<'google' | 'facebook' | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<AdAccount | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await listAdAccounts();
      setAccounts(res.data.accounts);
    } catch (error) {
      console.error('Failed to fetch ad accounts:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const handleConnectGoogle = async () => {
    try {
      setConnectingPlatform('google');
      const res = await connectGoogleAds();
      // Open OAuth flow in new window
      window.open(res.data.authUrl, '_blank', 'width=600,height=700');
      toast({
        title: 'Google Ads Connection',
        description: 'Complete the authorization in the popup window.',
      });
    } catch (error) {
      console.error('Failed to connect Google Ads:', error);
      toast({
        title: 'Connection Failed',
        description: 'Failed to initiate Google Ads connection. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handleConnectFacebook = async () => {
    try {
      setConnectingPlatform('facebook');
      const res = await connectFacebookAds();
      // Open OAuth flow in new window
      window.open(res.data.authUrl, '_blank', 'width=600,height=700');
      toast({
        title: 'Facebook Ads Connection',
        description: 'Complete the authorization in the popup window.',
      });
    } catch (error) {
      console.error('Failed to connect Facebook Ads:', error);
      toast({
        title: 'Connection Failed',
        description: 'Failed to initiate Facebook Ads connection. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handleSync = async (account: AdAccount) => {
    try {
      setSyncingId(account.id);
      const res = await syncAdAccount(account.id);
      // Update the account in the list
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id
            ? { ...a, lastSyncAt: res.data.lastSyncAt, status: 'active' }
            : a
        )
      );
      toast({
        title: 'Sync Complete',
        description: `${account.accountName} has been synced successfully.`,
      });
    } catch (error) {
      console.error('Failed to sync account:', error);
      toast({
        title: 'Sync Failed',
        description: `Failed to sync ${account.accountName}. Please try again.`,
        variant: 'destructive',
      });
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async () => {
    if (!confirmDisconnect) return;

    try {
      setDisconnectingId(confirmDisconnect.id);
      await disconnectAdAccount(confirmDisconnect.id);
      setAccounts((prev) => prev.filter((a) => a.id !== confirmDisconnect.id));
      toast({
        title: 'Account Disconnected',
        description: `${confirmDisconnect.accountName} has been disconnected.`,
      });
    } catch (error) {
      console.error('Failed to disconnect account:', error);
      toast({
        title: 'Disconnect Failed',
        description: `Failed to disconnect ${confirmDisconnect.accountName}. Please try again.`,
        variant: 'destructive',
      });
    } finally {
      setDisconnectingId(null);
      setConfirmDisconnect(null);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const StatusIcon = ({ status }: { status: AdAccount['status'] }) => {
    switch (status) {
      case 'active':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'disconnected':
        return <XCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i} className="bg-white/[0.02] border-white/5">
              <CardContent className="p-6">
                <div className="animate-pulse h-20 bg-white/5 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connect Buttons */}
      <div className="flex gap-4">
        <Button
          onClick={handleConnectGoogle}
          disabled={connectingPlatform === 'google'}
          className="gap-2 bg-blue-600 hover:bg-blue-700"
        >
          {connectingPlatform === 'google' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="w-4 h-4 rounded bg-white flex items-center justify-center text-blue-600 text-xs font-bold">
              G
            </div>
          )}
          Connect Google Ads
        </Button>
        <Button
          onClick={handleConnectFacebook}
          disabled={connectingPlatform === 'facebook'}
          className="gap-2 bg-indigo-600 hover:bg-indigo-700"
        >
          {connectingPlatform === 'facebook' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="w-4 h-4 rounded bg-white flex items-center justify-center text-indigo-600 text-xs font-bold">
              f
            </div>
          )}
          Connect Facebook Ads
        </Button>
      </div>

      {/* Connected Accounts */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader>
          <CardTitle className="text-lg text-white">Connected Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-2">No ad accounts connected yet.</p>
              <p className="text-gray-500 text-sm">
                Connect your Google Ads or Facebook Ads account to start tracking.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-white/[0.02] border border-white/5"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold',
                        account.platform === 'google'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-indigo-500/10 text-indigo-400'
                      )}
                    >
                      {account.platform === 'google' ? 'G' : 'f'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">
                          {account.accountName}
                        </span>
                        <StatusIcon status={account.status} />
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <span>ID: {account.accountId}</span>
                        <span className="text-gray-600">|</span>
                        <span>Last sync: {formatDate(account.lastSyncAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(account)}
                      disabled={syncingId === account.id}
                      className="gap-1"
                    >
                      {syncingId === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Sync
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDisconnect(account)}
                      disabled={disconnectingId === account.id}
                      className="gap-1 text-red-400 hover:text-red-300 hover:border-red-400/50"
                    >
                      {disconnectingId === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Unlink className="h-4 w-4" />
                      )}
                      Disconnect
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-campfire-500/10 text-campfire-500">
              <ExternalLink className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-white font-medium mb-1">OAuth Integration</h3>
              <p className="text-gray-400 text-sm">
                When you connect an ad account, you&apos;ll be redirected to authorize access through the
                platform&apos;s OAuth flow. This allows us to securely pull campaign data without storing
                your credentials.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={!!confirmDisconnect} onOpenChange={() => setConfirmDisconnect(null)}>
        <AlertDialogContent className="bg-zinc-900 border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Disconnect Account</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              Are you sure you want to disconnect{' '}
              <span className="text-white font-medium">{confirmDisconnect?.accountName}</span>?
              Historical data will be preserved, but new data will no longer sync.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10 text-white hover:bg-white/10">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
