'use client';

/**
 * Support Modal Component
 * Modal for users to submit support tickets with category, subject, and message.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, X, HelpCircle, CheckCircle } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  createSupportTicket,
  type SupportCategory,
} from '@/lib/api/support';

interface SupportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'bug_report', label: 'Bug Report' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'account_issue', label: 'Account Issue' },
  { value: 'billing', label: 'Billing' },
  { value: 'other', label: 'Other' },
];

export function SupportModal({ open, onOpenChange }: SupportModalProps) {
  const [category, setCategory] = useState<SupportCategory | ''>('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      // Delay reset to allow close animation
      const timeout = setTimeout(() => {
        setCategory('');
        setSubject('');
        setMessage('');
        setError(null);
        setIsSuccess(false);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  // Auto-close after success
  useEffect(() => {
    if (isSuccess) {
      const timeout = setTimeout(() => {
        onOpenChange(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [isSuccess, onOpenChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!category || !subject.trim() || !message.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setIsSubmitting(true);

    try {
      await createSupportTicket({
        category,
        subject: subject.trim(),
        message: message.trim(),
      });
      setIsSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to submit ticket. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = category && subject.trim() && message.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] w-full max-w-md rounded-3xl border-0 bg-gradient-to-b from-background to-muted/30 p-0 overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          {/* Close button */}
          <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          {isSuccess ? (
            // Success state
            <div className="flex flex-col items-center justify-center py-16 px-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', duration: 0.5, bounce: 0.4 }}
                className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/30"
              >
                <CheckCircle className="h-10 w-10 text-white" />
              </motion.div>
              <motion.h3
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-xl font-bold text-center"
              >
                Thanks!
              </motion.h3>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-muted-foreground text-center mt-2"
              >
                We'll get back to you soon.
              </motion.p>
            </div>
          ) : (
            // Form state
            <>
              {/* Header */}
              <div className="relative pt-8 pb-4 px-6 bg-gradient-to-b from-campfire-500/10 to-transparent">
                <DialogHeader className="text-center">
                  <motion.div
                    initial={{ scale: 0, rotate: -10 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', duration: 0.6, bounce: 0.4 }}
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-campfire-500 to-campfire-600 shadow-lg shadow-campfire-500/30"
                  >
                    <HelpCircle className="h-8 w-8 text-white" />
                  </motion.div>
                  <DialogTitle className="text-2xl font-bold">
                    Contact Support
                  </DialogTitle>
                  <DialogDescription className="text-base text-muted-foreground">
                    How can we help you today?
                  </DialogDescription>
                </DialogHeader>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
                {/* Category Select */}
                <div className="space-y-2">
                  <Label htmlFor="category" className="text-sm font-medium">
                    Category
                  </Label>
                  <Select
                    value={category}
                    onValueChange={(value) => setCategory(value as SupportCategory)}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger
                      id="category"
                      className="rounded-xl h-11 bg-muted/30 border-border/50 focus:border-campfire-500"
                    >
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Subject Input */}
                <div className="space-y-2">
                  <Label htmlFor="subject" className="text-sm font-medium">
                    Subject
                  </Label>
                  <Input
                    id="subject"
                    type="text"
                    placeholder="Brief description of your issue"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={isSubmitting}
                    className="rounded-xl h-11 bg-muted/30 border-border/50 focus:border-campfire-500"
                  />
                </div>

                {/* Message Textarea */}
                <div className="space-y-2">
                  <Label htmlFor="message" className="text-sm font-medium">
                    Message
                  </Label>
                  <Textarea
                    id="message"
                    placeholder="Please describe your issue in detail..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={isSubmitting}
                    rows={4}
                    className={cn(
                      'rounded-xl bg-muted/30 border-border/50 focus:border-campfire-500 resize-none',
                      'min-h-[120px]'
                    )}
                  />
                </div>

                {/* Error Message */}
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-xl"
                  >
                    {error}
                  </motion.p>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  className="w-full h-12 rounded-2xl text-base font-semibold bg-campfire-500 hover:bg-campfire-600 shadow-md shadow-campfire-500/20"
                  disabled={isSubmitting || !isFormValid}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
                </Button>
              </form>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
