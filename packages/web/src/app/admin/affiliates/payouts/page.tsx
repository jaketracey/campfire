'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, RefreshCw, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  getPendingPayouts,
  markConversionPaid,
  updateConversionStatus,
  type PendingPayout,
} from '@/lib/api/affiliates';

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<PendingPayout[]>([]);
  const [totalPending, setTotalPending] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchPayouts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await getPendingPayouts();
      setPayouts(response.data.payouts);
      setTotalPending(response.data.totalPending);
    } catch (error) {
      console.error('Failed to fetch payouts:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  const handleApprove = async (conversionId: string) => {
    setProcessingId(conversionId);
    try {
      await updateConversionStatus(conversionId, { status: 'approved' });
      await fetchPayouts();
    } catch (error) {
      console.error('Failed to approve conversion:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (conversionId: string) => {
    setProcessingId(conversionId);
    try {
      await updateConversionStatus(conversionId, { status: 'rejected', rejectionReason: 'Rejected by admin' });
      await fetchPayouts();
    } catch (error) {
      console.error('Failed to reject conversion:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const handleMarkPaid = async (conversionId: string) => {
    setProcessingId(conversionId);
    try {
      await markConversionPaid(conversionId);
      await fetchPayouts();
    } catch (error) {
      console.error('Failed to mark as paid:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const handlePayAll = async (affiliatePayouts: PendingPayout) => {
    for (const conv of affiliatePayouts.conversions) {
      setProcessingId(conv.id);
      try {
        await markConversionPaid(conv.id);
      } catch (error) {
        console.error('Failed to mark as paid:', error);
      }
    }
    setProcessingId(null);
    await fetchPayouts();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={'/admin/affiliates' as Route}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Pending Payouts</h1>
            <p className="text-gray-400 text-sm">
              Review and process affiliate payouts
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={fetchPayouts}
          disabled={isLoading}
          className="border-white/10"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Card */}
      <Card className="bg-yellow-500/5 border-yellow-500/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-yellow-500" />
              <div>
                <p className="text-sm text-yellow-400">Total Pending Payouts</p>
                <p className="text-2xl font-bold text-white">{formatCurrency(totalPending)}</p>
              </div>
            </div>
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
              {payouts.length} affiliate{payouts.length !== 1 ? 's' : ''} awaiting payment
            </Badge>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-pulse text-gray-500">Loading payouts...</div>
        </div>
      ) : payouts.length === 0 ? (
        <Card className="bg-white/[0.02] border-white/5">
          <CardContent className="py-16 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-xl font-medium text-white">All caught up!</p>
            <p className="text-gray-400 mt-2">No pending payouts at this time.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {payouts.map((payout) => (
            <Card key={payout.affiliateId} className="bg-white/[0.02] border-white/5">
              <CardHeader className="border-b border-white/5">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg text-white">{payout.affiliateName}</CardTitle>
                    <p className="text-sm text-gray-400 mt-1">
                      <span className="text-campfire-400">{payout.affiliateCode}</span>
                      {' · '}{payout.affiliateEmail}
                    </p>
                    {payout.payoutInfo && (
                      <p className="text-xs text-gray-500 mt-2">
                        Payout:{' '}
                        {payout.payoutInfo.type === 'paypal' && `PayPal: ${payout.payoutInfo.paypalEmail}`}
                        {payout.payoutInfo.type === 'bank' && `Bank: ${payout.payoutInfo.bankName} ****${payout.payoutInfo.accountNumber?.slice(-4)}`}
                        {payout.payoutInfo.type === 'other' && payout.payoutInfo.notes}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-yellow-400">
                      {formatCurrency(payout.pendingAmount)}
                    </p>
                    <p className="text-xs text-gray-500">{payout.pendingCount} conversion{payout.pendingCount !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Plan</th>
                      <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">Commission</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {payout.conversions.map((conv) => (
                      <tr key={conv.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4">
                          <Badge variant="outline" className={
                            conv.planTier === 'premium'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          }>
                            {conv.planTier === 'premium' ? 'Premium' : 'Standard'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-white font-medium">{formatCurrency(conv.commissionAmount)}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-sm">
                          {formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReject(conv.id)}
                              disabled={processingId === conv.id}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleApprove(conv.id)}
                              disabled={processingId === conv.id}
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            >
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMarkPaid(conv.id)}
                              disabled={processingId === conv.id}
                              className="text-green-400 hover:text-green-300 hover:bg-green-500/10"
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Paid
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pay All Button */}
                <div className="p-4 border-t border-white/5 flex justify-end">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button className="bg-green-600 hover:bg-green-700">
                        <DollarSign className="h-4 w-4 mr-2" />
                        Mark All as Paid ({formatCurrency(payout.pendingAmount)})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will mark all {payout.pendingCount} conversion{payout.pendingCount !== 1 ? 's' : ''}
                          ({formatCurrency(payout.pendingAmount)}) for {payout.affiliateName} as paid.
                          Make sure you've sent the payment before confirming.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handlePayAll(payout)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          Confirm Payment
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
