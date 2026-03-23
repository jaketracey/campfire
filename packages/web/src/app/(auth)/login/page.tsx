'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { toast } = useToast();
  const { login, loginWithGoogle, isLoading: authLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const isLoading = authLoading || isSubmitting || isGoogleLoading;

  const handleGoogleSuccess = useCallback(
    async (idToken: string) => {
      setIsGoogleLoading(true);
      try {
        await loginWithGoogle({ idToken }, false);
        toast({
          title: 'Welcome back!',
          description: 'You have successfully signed in with Google.',
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Google sign-in failed. Please try again.';
        toast({
          title: 'Sign-in failed',
          description: message,
          variant: 'destructive',
        });
      } finally {
        setIsGoogleLoading(false);
      }
    },
    [loginWithGoogle, toast]
  );

  const handleGoogleError = useCallback(
    (error: Error) => {
      toast({
        title: 'Sign-in failed',
        description: error.message || 'Google sign-in failed. Please try again.',
        variant: 'destructive',
      });
    },
    [toast]
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    try {
      const result = await login(data);

      if (result.requiresMFA) {
        toast({
          title: 'Two-factor authentication required',
          description: 'Please enter your verification code.',
        });
        return;
      }

      toast({
        title: 'Welcome back!',
        description: 'You have successfully logged in.',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Please check your credentials and try again.';
      toast({
        title: 'Login failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="bg-white/[0.03] backdrop-blur-xl border-white/10">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold text-white">Welcome back</CardTitle>
        <CardDescription className="text-white/60">
          Sign in to your account to continue
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <GoogleSignInButton
            onSuccess={handleGoogleSuccess}
            onError={handleGoogleError}
            text="signin"
            disabled={isLoading}
          />

          <div className="relative w-full">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#0a0a0a] px-2 text-white/40">
                or
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-white/80">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              data-testid="login-email-input"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
              disabled={isLoading}
            />
            {errors.email && (
              <p className="text-sm text-destructive" id="email-error" role="alert" data-testid="login-email-error">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-white/80">Password</Label>
              <Link
                href="/forgot-password"
                className="text-sm text-white/40 hover:text-white/60"
                data-testid="login-forgot-password-link"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                data-testid="login-password-input"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
                disabled={isLoading}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
                data-testid="login-password-toggle"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {errors.password && (
              <p className="text-sm text-destructive" id="password-error" role="alert" data-testid="login-password-error">{errors.password.message}</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full"
            variant="campfire"
            size="lg"
            disabled={isLoading}
            data-testid="login-submit-button"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </Button>

          <p className="text-sm text-white/40 text-center">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-campfire-400 hover:text-campfire-300 hover:underline" data-testid="login-signup-link">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
