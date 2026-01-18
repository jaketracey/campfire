'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Shield, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

export default function TwoFactorPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const pastedCode = value.slice(0, 6).split('');
      const newCode = [...code];
      pastedCode.forEach((char, i) => {
        if (index + i < 6) {
          newCode[index + i] = char;
        }
      });
      setCode(newCode);
      const nextIndex = Math.min(index + pastedCode.length, 5);
      inputRefs.current[nextIndex]?.focus();
    } else {
      const newCode = [...code];
      newCode[index] = value;
      setCode(newCode);

      // Auto-focus next input
      if (value && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      toast({
        title: 'Invalid code',
        description: 'Please enter the complete 6-digit code.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      // TODO: Implement actual 2FA verification
      console.log('2FA code:', fullCode);

      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      toast({
        title: 'Verified!',
        description: 'Two-factor authentication successful.',
      });

      router.push('/dashboard');
    } catch (error) {
      toast({
        title: 'Verification failed',
        description: 'Invalid code. Please try again.',
        variant: 'destructive',
      });
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsLoading(true);
    try {
      // TODO: Implement resend code API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      toast({
        title: 'Code sent!',
        description: 'A new verification code has been sent.',
      });
    } catch (error) {
      toast({
        title: 'Failed to resend',
        description: 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-campfire-500/10">
          <Shield className="h-8 w-8 text-campfire-500" />
        </div>
        <CardTitle className="text-2xl font-bold">Two-factor authentication</CardTitle>
        <CardDescription>
          Enter the verification code to secure your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="app" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="app" data-testid="mfa-authenticator-tab">
              <Smartphone className="mr-2 h-4 w-4" />
              Authenticator
            </TabsTrigger>
            <TabsTrigger value="sms" data-testid="mfa-sms-tab">
              SMS
            </TabsTrigger>
          </TabsList>
          <TabsContent value="app" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground text-center">
              Enter the 6-digit code from your authenticator app
            </p>
            <div className="flex justify-center gap-2">
              {code.map((digit, index) => (
                <Input
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="h-12 w-12 text-center text-lg font-semibold"
                  disabled={isLoading}
                  data-testid="mfa-code-input"
                />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="sms" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground text-center">
              Enter the 6-digit code sent to your phone number ending in ****1234
            </p>
            <div className="flex justify-center gap-2">
              {code.map((digit, index) => (
                <Input
                  key={index}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="h-12 w-12 text-center text-lg font-semibold"
                  disabled={isLoading}
                  data-testid="mfa-code-input"
                />
              ))}
            </div>
            <div className="text-center">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={handleResend}
                disabled={isLoading}
                data-testid="mfa-resend-button"
              >
                Didn&apos;t receive a code? Resend
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex flex-col gap-4">
        <Button
          onClick={handleVerify}
          className="w-full"
          variant="campfire"
          size="lg"
          disabled={isLoading || code.join('').length !== 6}
          data-testid="mfa-verify-button"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify
        </Button>
        <Link
          href="/login"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary"
          data-testid="mfa-back-to-login"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
