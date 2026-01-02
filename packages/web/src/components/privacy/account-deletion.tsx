'use client';

/**
 * Account Deletion Component
 * Multi-step confirmation flow for account deletion.
 * Dramatic, serious design to emphasize the irreversibility.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, AlertTriangle, Download, MessageSquare, Heart, Image, Loader2, Check, X, ArrowLeft } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

type DeletionStep = 'overview' | 'data-export' | 'confirm' | 'final' | 'processing' | 'complete';

interface AccountDeletionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  onExportData?: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}

interface DataSummary {
  conversations: number;
  memories: number;
  companions: number;
  images: number;
}

export function AccountDeletionModal({
  open,
  onOpenChange,
  userEmail,
  onExportData,
  onDeleteAccount,
}: AccountDeletionModalProps) {
  const [step, setStep] = useState<DeletionStep>('overview');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirmChecks, setConfirmChecks] = useState({
    understand: false,
    noRecovery: false,
    dataLoss: false,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mock data summary - replace with actual API call
  const [dataSummary] = useState<DataSummary>({
    conversations: 127,
    memories: 384,
    companions: 3,
    images: 52,
  });

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep('overview');
        setConfirmEmail('');
        setConfirmChecks({ understand: false, noRecovery: false, dataLoss: false });
        setError(null);
      }, 200);
    }
  }, [open]);

  const canProceedToFinal =
    confirmEmail.toLowerCase() === userEmail.toLowerCase() &&
    confirmChecks.understand &&
    confirmChecks.noRecovery &&
    confirmChecks.dataLoss;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await onExportData?.();
    } catch {
      setError('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setStep('processing');
    try {
      await onDeleteAccount();
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setStep('final');
      setIsDeleting(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'overview':
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            {/* Warning header */}
            <div className="flex flex-col items-center text-center">
              <div className="p-4 rounded-2xl bg-ember-500/10 mb-4">
                <Trash2 className="w-8 h-8 text-ember-500" />
              </div>
              <DialogTitle className="text-xl font-bold">Delete Your Account?</DialogTitle>
              <DialogDescription className="text-muted-foreground mt-2">
                This action is permanent and cannot be undone.
              </DialogDescription>
            </div>

            {/* What will be deleted */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">What will be deleted:</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-muted/30">
                  <MessageSquare className="w-5 h-5 text-vibes-electric mb-2" />
                  <p className="text-2xl font-bold">{dataSummary.conversations}</p>
                  <p className="text-xs text-muted-foreground">Conversations</p>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30">
                  <Heart className="w-5 h-5 text-vibes-hot mb-2" />
                  <p className="text-2xl font-bold">{dataSummary.memories}</p>
                  <p className="text-xs text-muted-foreground">Memories</p>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30">
                  <span className="text-2xl mb-2 block">👤</span>
                  <p className="text-2xl font-bold">{dataSummary.companions}</p>
                  <p className="text-xs text-muted-foreground">Companions</p>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30">
                  <Image className="w-5 h-5 text-vibes-neon mb-2" />
                  <p className="text-2xl font-bold">{dataSummary.images}</p>
                  <p className="text-xs text-muted-foreground">Images</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setStep('data-export')}
                className="w-full rounded-2xl h-12 justify-start gap-3"
              >
                <Download className="w-4 h-4" />
                Export my data first
              </Button>
              <Button
                onClick={() => setStep('confirm')}
                className="w-full rounded-2xl h-12 bg-ember-500/10 hover:bg-ember-500/20 text-ember-500"
              >
                Continue with deletion
              </Button>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="w-full rounded-2xl"
              >
                Cancel
              </Button>
            </div>
          </motion.div>
        );

      case 'data-export':
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <button
              onClick={() => setStep('overview')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="p-4 rounded-2xl bg-vibes-electric/10 mb-4">
                <Download className="w-8 h-8 text-vibes-electric" />
              </div>
              <DialogTitle className="text-xl font-bold">Export Your Data</DialogTitle>
              <DialogDescription className="text-muted-foreground mt-2">
                Download a copy of all your data before deleting your account.
              </DialogDescription>
            </div>

            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-muted/30">
                <h4 className="font-medium mb-2">Your export will include:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-500" /> Account information
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-500" /> All conversation history
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-500" /> Memories and knowledge graph
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-500" /> Companion configurations
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-3 h-3 text-green-500" /> Generated images
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={handleExport}
                disabled={isExporting}
                className="w-full rounded-2xl h-12 bg-vibes-electric hover:bg-vibes-electric/90"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Preparing export...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download my data
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setStep('confirm')}
                className="w-full rounded-2xl text-muted-foreground"
              >
                Skip and continue
              </Button>
            </div>
          </motion.div>
        );

      case 'confirm':
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <button
              onClick={() => setStep('overview')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="p-4 rounded-2xl bg-ember-500/10 mb-4">
                <AlertTriangle className="w-8 h-8 text-ember-500" />
              </div>
              <DialogTitle className="text-xl font-bold">Final Confirmation</DialogTitle>
              <DialogDescription className="text-muted-foreground mt-2">
                Please confirm that you understand the consequences.
              </DialogDescription>
            </div>

            {/* Confirmation checkboxes */}
            <div className="space-y-3">
              {[
                { key: 'understand', label: 'I understand this action is permanent' },
                { key: 'noRecovery', label: 'I understand my account cannot be recovered' },
                { key: 'dataLoss', label: 'I understand all my data will be permanently deleted' },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className={cn(
                    "flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all",
                    "bg-muted/30 hover:bg-muted/50",
                    confirmChecks[key as keyof typeof confirmChecks] && "bg-ember-500/10"
                  )}
                >
                  <Checkbox
                    checked={confirmChecks[key as keyof typeof confirmChecks]}
                    onCheckedChange={(checked) =>
                      setConfirmChecks(prev => ({ ...prev, [key]: !!checked }))
                    }
                    className="data-[state=checked]:bg-ember-500 data-[state=checked]:border-ember-500"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>

            {/* Email confirmation */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Type your email to confirm: <span className="text-muted-foreground">{userEmail}</span>
              </label>
              <Input
                type="email"
                placeholder="Enter your email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                className="rounded-xl h-11 bg-muted/30"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={() => setStep('final')}
                disabled={!canProceedToFinal}
                className={cn(
                  "w-full rounded-2xl h-12 transition-all",
                  canProceedToFinal
                    ? "bg-ember-600 hover:bg-ember-700 text-white"
                    : "bg-muted text-muted-foreground"
                )}
              >
                Proceed to delete account
              </Button>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="w-full rounded-2xl"
              >
                Cancel
              </Button>
            </div>
          </motion.div>
        );

      case 'final':
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <button
              onClick={() => setStep('confirm')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="flex flex-col items-center text-center py-4">
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', bounce: 0.5 }}
                className="p-6 rounded-3xl bg-ember-500/10 mb-6"
              >
                <Trash2 className="w-12 h-12 text-ember-500" />
              </motion.div>
              <DialogTitle className="text-2xl font-bold">Are you absolutely sure?</DialogTitle>
              <DialogDescription className="text-muted-foreground mt-3 max-w-[280px]">
                This is your last chance to change your mind. Once you click delete, there's no going back.
              </DialogDescription>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <Button
                onClick={handleDelete}
                disabled={isDeleting}
                className="w-full rounded-2xl h-14 bg-ember-600 hover:bg-ember-700 text-white text-base font-semibold"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete my account forever'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="w-full rounded-2xl h-12"
              >
                No, keep my account
              </Button>
            </div>
          </motion.div>
        );

      case 'processing':
        return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-12 space-y-6"
          >
            <div className="relative">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                className="w-16 h-16 rounded-full border-2 border-muted border-t-ember-500"
              />
              <Trash2 className="w-6 h-6 text-ember-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <div className="text-center">
              <p className="font-semibold">Deleting your account...</p>
              <p className="text-sm text-muted-foreground">This may take a moment</p>
            </div>
          </motion.div>
        );

      case 'complete':
        return (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-12 space-y-6"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', bounce: 0.5 }}
              className="p-4 rounded-full bg-green-500/10"
            >
              <Check className="w-8 h-8 text-green-500" />
            </motion.div>
            <div className="text-center">
              <p className="font-semibold text-lg">Account Deleted</p>
              <p className="text-sm text-muted-foreground mt-2">
                Your account and all associated data have been permanently deleted.
              </p>
            </div>
            <Button
              onClick={() => window.location.href = '/'}
              className="rounded-2xl"
            >
              Return to homepage
            </Button>
          </motion.div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 rounded-3xl border-0 bg-background/95 backdrop-blur-xl">
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Simple trigger button for account deletion
 */
interface DeleteAccountButtonProps {
  userEmail: string;
  onExportData?: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  className?: string;
}

export function DeleteAccountButton({
  userEmail,
  onExportData,
  onDeleteAccount,
  className,
}: DeleteAccountButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        className={cn(
          "text-ember-500 hover:text-ember-600 hover:bg-ember-500/10",
          className
        )}
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Delete Account
      </Button>

      <AccountDeletionModal
        open={open}
        onOpenChange={setOpen}
        userEmail={userEmail}
        onExportData={onExportData}
        onDeleteAccount={onDeleteAccount}
      />
    </>
  );
}
