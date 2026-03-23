'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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

const signupSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms and conditions' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type SignupFormData = z.infer<typeof signupSchema>;

// UTM parameters to capture
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;
type UtmParamKey = typeof UTM_PARAMS[number];
type UtmParams = Partial<Record<UtmParamKey, string>>;

const passwordRequirements = [
  { regex: /.{8,}/, label: 'At least 8 characters' },
  { regex: /[A-Z]/, label: 'One uppercase letter' },
  { regex: /[a-z]/, label: 'One lowercase letter' },
  { regex: /[0-9]/, label: 'One number' },
];

export default function SignupPage() {
  const { toast } = useToast();
  const { signup, loginWithGoogle, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const isLoading = authLoading || isSubmitting || isGoogleLoading;
  const returnTo = searchParams.get('returnTo');

  // Extract UTM parameters from URL
  const utmParams = useMemo<UtmParams>(() => {
    const params: UtmParams = {};
    for (const key of UTM_PARAMS) {
      const value = searchParams.get(key);
      if (value) {
        params[key] = value;
      }
    }
    return params;
  }, [searchParams]);

  // Store UTM params in localStorage as backup
  useEffect(() => {
    if (Object.keys(utmParams).length > 0) {
      localStorage.setItem('utm_params', JSON.stringify(utmParams));
    }
  }, [utmParams]);

  // Helper to get UTM params (from current state or localStorage backup)
  const getUtmParams = useCallback((): UtmParams => {
    if (Object.keys(utmParams).length > 0) {
      return utmParams;
    }
    // Try localStorage backup
    try {
      const stored = localStorage.getItem('utm_params');
      if (stored) {
        return JSON.parse(stored) as UtmParams;
      }
    } catch {
      // Ignore parse errors
    }
    return {};
  }, [utmParams]);

  const handleGoogleSuccess = useCallback(
    async (idToken: string) => {
      setIsGoogleLoading(true);
      try {
        const params = getUtmParams();
        await loginWithGoogle({ idToken, utmParams: params }, true, { returnTo });
        toast({
          title: 'Account created!',
          description: 'Welcome to Ignite.',
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Google sign-up failed. Please try again.';
        toast({
          title: 'Sign-up failed',
          description: message,
          variant: 'destructive',
        });
      } finally {
        setIsGoogleLoading(false);
      }
    },
    [loginWithGoogle, toast, getUtmParams, returnTo]
  );

  const handleGoogleError = useCallback(
    (error: Error) => {
      toast({
        title: 'Sign-up failed',
        description: error.message || 'Google sign-up failed. Please try again.',
        variant: 'destructive',
      });
    },
    [toast]
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      acceptTerms: false as unknown as true,
    },
  });

  const password = watch('password', '');
  const acceptTerms = watch('acceptTerms');

  const onSubmit = async (data: SignupFormData) => {
    setIsSubmitting(true);
    try {
      const params = getUtmParams();
      await signup({
        email: data.email,
        password: data.password,
        displayName: data.name,
        utmParams: params,
      }, { returnTo });

      toast({
        title: 'Account created!',
        description: 'Welcome to Ignite.',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Please try again later.';
      toast({
        title: 'Signup failed',
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
        <CardTitle className="text-2xl font-bold text-white">Create an account</CardTitle>
        <CardDescription className="text-white/60">
          Start your journey with your AI companion
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <GoogleSignInButton
            onSuccess={handleGoogleSuccess}
            onError={handleGoogleError}
            text="signup"
            disabled={isLoading}
          />
          <p className="text-[11px] text-white/40 text-center -mt-1">
            By signing up with Google, you agree to our{' '}
            <Link href="/terms" className="underline hover:text-white/60">Terms</Link> and{' '}
            <Link href="/privacy" className="underline hover:text-white/60">Privacy Policy</Link>.
          </p>

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
            <Label htmlFor="name" className="text-white/80">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              data-testid="signup-name-input"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'name-error' : undefined}
              {...register('name')}
              disabled={isLoading}
            />
            {errors.name && (
              <p className="text-sm text-destructive" id="name-error" role="alert" data-testid="signup-name-error">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-white/80">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              data-testid="signup-email-input"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
              disabled={isLoading}
            />
            {errors.email && (
              <p className="text-sm text-destructive" id="email-error" role="alert" data-testid="signup-email-error">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-white/80">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a password"
                data-testid="signup-password-input"
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
                data-testid="signup-password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {password && (
              <div className="mt-2 space-y-1">
                {passwordRequirements.map((req, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 text-xs"
                    data-testid="password-strength-indicator"
                  >
                    {req.regex.test(password) ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <X className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span
                      className={
                        req.regex.test(password)
                          ? 'text-green-500'
                          : 'text-muted-foreground'
                      }
                    >
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {errors.password && (
              <p className="text-sm text-destructive" id="password-error" role="alert" data-testid="signup-password-error">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-white/80">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm your password"
                data-testid="signup-confirm-password-input"
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                {...register('confirmPassword')}
                disabled={isLoading}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                disabled={isLoading}
                data-testid="signup-confirm-password-toggle"
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {errors.confirmPassword && (
              <p className="text-sm text-destructive" id="confirm-password-error" role="alert" data-testid="signup-confirm-password-error">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="terms"
              checked={acceptTerms}
              onCheckedChange={(checked) =>
                setValue('acceptTerms', checked as true)
              }
              disabled={isLoading}
              aria-invalid={!!errors.acceptTerms}
              aria-describedby={errors.acceptTerms ? 'terms-error' : undefined}
              className="border-white/30 data-[state=checked]:bg-campfire-500 data-[state=checked]:border-campfire-500"
              data-testid="signup-terms-checkbox"
            />
            <Label
              htmlFor="terms"
              className="text-sm font-normal leading-none cursor-pointer text-white/60"
            >
              I agree to the{' '}
              <a
                href="https://ignite.cam/terms"
                className="text-campfire-400 hover:text-campfire-300 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href="https://ignite.cam/privacy"
                className="text-campfire-400 hover:text-campfire-300 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Privacy Policy
              </a>
            </Label>
          </div>
          {errors.acceptTerms && (
            <p className="text-sm text-destructive" id="terms-error" role="alert" data-testid="signup-terms-error">
              {errors.acceptTerms.message}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full"
            variant="campfire"
            size="lg"
            disabled={isLoading}
            data-testid="signup-submit-button"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create account
          </Button>

          <p className="text-sm text-white/40 text-center">
            Already have an account?{' '}
            <Link href="/login" className="text-campfire-400 hover:text-campfire-300 hover:underline" data-testid="signup-login-link">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
