'use client';

import { useEffect, useState, useRef } from 'react';
import { useFlowguard } from '@/hooks/use-flowguard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, CreditCard, AlertCircle } from 'lucide-react';

interface FlowguardPaymentProps {
  sessionId: string;
  amount: number;
  currency?: string;
  description?: string;
  /** Called on SDK errors (init or submit failures). Success/decline are handled via URL redirects. */
  onError?: (error: string) => void;
  onCancel?: () => void;
}

/**
 * FlowguardPayment Component
 *
 * Renders an inline payment form using the Flowguard SDK.
 * The SDK creates secure hosted iframes for the card input fields.
 *
 * NOTE: Payment success/decline are handled via URL redirects configured
 * in the session (successUrl/declineUrl), not via JavaScript callbacks.
 * After form submission, the browser will redirect to the appropriate URL.
 *
 * Required container IDs for Flowguard hosted fields:
 * - card-number-element: Credit card number input
 * - cvv-element: CVV/CVC input
 * - cardholder-element: Cardholder name input
 * - exp-date-element: Expiration date input
 * - price-element: Price display (optional)
 */
export function FlowguardPayment({
  sessionId,
  amount,
  currency = 'USD',
  description,
  onError,
  onCancel,
}: FlowguardPaymentProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const { isLoading, isReady, isSubmitting, error, initialize, submit, remove } = useFlowguard();

  // Use ref for callback to avoid infinite re-render loop
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Initialize Flowguard when component mounts
  // NOTE: Success/decline are handled via URL redirects configured in the session,
  // not via JavaScript callbacks.
  useEffect(() => {
    if (!sessionId || isInitialized) return;

    const init = async () => {
      try {
        await initialize({
          sessionId,
          onError: (error) => {
            onErrorRef.current?.(error.errorDescription);
          },
          onSubmitError: (error) => {
            onErrorRef.current?.(error.errorDescription);
          },
        });
        setIsInitialized(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initialize payment';
        onErrorRef.current?.(message);
      }
    };

    init();

    return () => {
      remove();
      setIsInitialized(false);
    };
  }, [sessionId, initialize, remove, isInitialized]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await submit();
    } catch {
      // Error is handled in the callback
    }
  };

  const formatAmount = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(cents / 100);
  };

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading payment form...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Price Display */}
          {description && (
            <div className="text-center mb-6">
              <p className="text-sm text-muted-foreground">{description}</p>
              <p className="text-2xl font-bold mt-1">{formatAmount(amount)}</p>
            </div>
          )}

          {/* Flowguard Price Element (shows full breakdown) */}
          <div id="price-element" className="mb-4" />

          {/* Card Details Grid */}
          <div className="space-y-4">
            {/* Cardholder Name */}
            <div>
              <label htmlFor="cardholder-element" className="block text-sm font-medium mb-2">
                Cardholder Name
              </label>
              <div
                id="cardholder-element"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </div>

            {/* Card Number */}
            <div>
              <label htmlFor="card-number-element" className="block text-sm font-medium mb-2">
                Card Number
              </label>
              <div
                id="card-number-element"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2"
              />
            </div>

            {/* Expiry and CVV */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="exp-date-element" className="block text-sm font-medium mb-2">
                  Expiry Date
                </label>
                <div
                  id="exp-date-element"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="cvv-element" className="block text-sm font-medium mb-2">
                  CVV
                </label>
                <div
                  id="cvv-element"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                />
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex gap-3">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={!isReady || isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Pay {formatAmount(amount)}
                </>
              )}
            </Button>
          </div>

          {/* Security Note */}
          <p className="text-xs text-center text-muted-foreground">
            Your payment is secured by Flowguard. We never store your card details.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
