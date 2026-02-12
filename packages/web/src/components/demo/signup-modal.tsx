'use client';

/**
 * Signup Modal Component
 * Modal displayed when anonymous users reach their message limit or try to access
 * premium features. Includes Google sign-in and email/password with tab switcher.
 * Shows contextual messaging based on what triggered the modal.
 */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { Eye, EyeOff, Loader2, Check, X } from 'lucide-react';
import { AnimatedFlame } from '@/components/ui/animated-flame';
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
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { cn } from '@/lib/utils';

const COMPANIONS = [
  'female/black-athletic-black-bM.png', 'female/black-curvy-brown-bM.png', 'female/black-plus-size-red-bM.png',
  'female/caucasian-athletic-blonde-bM.png', 'female/caucasian-curvy-black-bM.png', 'female/caucasian-plus-size-brown-bM.png',
  'female/east-asian-athletic-red-bM.png', 'female/east-asian-curvy-black-bM.png', 'female/east-asian-slim-blonde-bM.png',
  'female/latina-athletic-brown-bM.png', 'female/latina-curvy-red-bM.png', 'female/latina-plus-size-black-bM.png',
];

function MiniCompanionBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const rows = containerRef.current.querySelectorAll('.companion-row-mini');

    rows.forEach((row, i) => {
      const direction = i % 2 === 0 ? -1 : 1;
      const duration = 120 + Math.random() * 60;

      if (direction === -1) {
        gsap.set(row, { x: '0%' });
        gsap.to(row, {
          x: '-50%',
          duration: duration,
          repeat: -1,
          ease: 'none',
        });
      } else {
        gsap.set(row, { x: '-50%' });
        gsap.to(row, {
          x: '0%',
          duration: duration,
          repeat: -1,
          ease: 'none',
        });
      }
    });
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden flex flex-col justify-around py-12 opacity-[0.15] pointer-events-none">
      {[0, 1, 2, 3].map((rowIndex) => (
        <div
          key={rowIndex}
          className="companion-row-mini flex gap-8 whitespace-nowrap"
          style={{ width: 'fit-content' }}
        >
          {[...COMPANIONS, ...COMPANIONS, ...COMPANIONS, ...COMPANIONS].map((img, i) => (
            <div key={i} className="w-40 h-56 md:w-56 md:h-80 relative flex-shrink-0 grayscale">
              <img
                src={`/images/companions/${img}`}
                alt=""
                className="w-full h-full object-cover rounded-2xl border border-white/10"
              />
            </div>
          ))}
        </div>
      ))}
      {/* Vignette overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_20%,black_80%)]" />
    </div>
  );
}

export type SignupTrigger =
  | 'message_limit'
  | 'gallery'
  | 'gifts'
  | 'debug'
  | 'account'
  | 'close'
  | 'avatar'
  | 'personality'
  | 'games'
  | 'friends'
  | 'design_companion'
  | 'voice'
  | 'webcam'
  | 'call'
  | 'video'
  | 'general';

interface TriggerContent {
  title: string;
  description: string;
  features: string[];
}

const triggerContent: Record<SignupTrigger, TriggerContent> = {
  message_limit: {
    title: 'Loving the Conversation?',
    description: 'Sign up now to keep chatting and unlock all features!',
    features: [
      'Unlimited conversations',
      'Create custom companions',
      'Voice chat support',
      'Saved conversation history',
      'Image generation',
    ],
  },
  gallery: {
    title: 'Unlock the Gallery',
    description: 'View all images of your companion and generate custom portraits & videos',
    features: [
      'Unlimited image gallery',
      'Generate custom portraits',
      'Video generation coming soon',
      'Download & share images',
      'Create memories together',
    ],
  },
  gifts: {
    title: 'Send Special Gifts',
    description: 'Surprise your companion with unique gifts that unlock special reactions',
    features: [
      'Exclusive gift collection',
      'Unlock special animations',
      'Build relationship bonds',
      'Earn gift achievements',
      'See companion reactions',
    ],
  },
  debug: {
    title: 'Developer Tools',
    description: 'Access advanced debugging and development features',
    features: [
      'View conversation context',
      'Monitor AI responses',
      'Debug session state',
      'Performance metrics',
      'API insights',
    ],
  },
  account: {
    title: 'Manage Your Account',
    description: 'Customize your profile, manage subscriptions, and personalize your experience',
    features: [
      'Personalized profile',
      'Subscription management',
      'Privacy controls',
      'Notification settings',
      'Connected accounts',
    ],
  },
  close: {
    title: 'Access Your Dashboard',
    description: 'View all your companions, conversation history, and manage your sessions',
    features: [
      'All your companions',
      'Conversation history',
      'Session management',
      'Quick companion switch',
      'Activity insights',
    ],
  },
  avatar: {
    title: 'Meet Your Companion',
    description: 'Unlock full companion customization, personality settings, and backstory',
    features: [
      'Customize personality',
      'Unlock backstory',
      'Full-size portraits',
      'Emotion expressions',
      'Visual customization',
    ],
  },
  personality: {
    title: 'Shape Their Soul',
    description: 'Fine-tune personality traits, communication style, and emotional responses',
    features: [
      'Adjust personality sliders',
      'Set communication style',
      'Choose emotional range',
      'Customize behavior',
      'Save personality presets',
    ],
  },
  games: {
    title: 'Play Together',
    description: 'Challenge your companion to games and build your bond through play',
    features: [
      'Play tic-tac-toe & more',
      'Competitive AI gameplay',
      'Track win/loss history',
      'Unlock game achievements',
      'New games added regularly',
    ],
  },
  friends: {
    title: 'Meet Their Friends',
    description: 'Invite other companions to join your conversations for group chats',
    features: [
      'Group conversations',
      'Meet companion friends',
      'Dynamic interactions',
      'Unique relationships',
      'Expand your circle',
    ],
  },
  design_companion: {
    title: 'Design Your Dream Companion',
    description: 'Create a fully custom AI companion tailored to your preferences',
    features: [
      'Choose appearance & style',
      'Define personality traits',
      'Set communication style',
      'Create unique backstory',
      'Unlimited customization',
    ],
  },
  voice: {
    title: 'Talk With Your Voice',
    description: 'Speak naturally and hear your companion respond with their unique voice',
    features: [
      'Voice-to-text messaging',
      'Natural conversations',
      'Companion voice replies',
      'Hands-free chatting',
      'Multiple voice options',
    ],
  },
  webcam: {
    title: 'Let Them See You',
    description: 'Share moments visually and get personalized responses based on what your companion sees',
    features: [
      'Visual awareness',
      'Personalized reactions',
      'Share your world',
      'Deeper connection',
      'Privacy controls',
    ],
  },
  call: {
    title: 'Voice Calls',
    description: 'Have real-time voice conversations with your companion',
    features: [
      'Natural voice conversations',
      'Real-time responses',
      'Voice activity detection',
      'Interrupt anytime',
      'Full transcripts saved',
    ],
  },
  video: {
    title: 'Video Messages',
    description: 'Request personalized video messages from your companion',
    features: [
      'AI-generated videos',
      'Custom video requests',
      'Save to gallery',
      'Share with friends',
      'High-quality output',
    ],
  },
  general: {
    title: 'Join Ignite',
    description: 'Create an account to unlock all features and premium content',
    features: [
      'Unlimited conversations',
      'Create custom companions',
      'Voice chat support',
      'Saved conversation history',
      'Image generation',
    ],
  },
};

interface SignupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoogleSuccess: (idToken: string) => Promise<void>;
  onGoogleError: (error: Error) => void;
  onEmailLogin?: (email: string, password: string) => Promise<void>;
  onEmailSignup?: (email: string, password: string, name?: string) => Promise<void>;
  trigger?: SignupTrigger;
}

type AuthMode = 'signup' | 'login';

export function SignupModal({
  open,
  onOpenChange,
  onGoogleSuccess,
  onGoogleError,
  onEmailLogin,
  onEmailSignup,
  trigger = 'general',
}: SignupModalProps) {
  const [mode, setMode] = useState<AuthMode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const contentRef = useRef<HTMLDivElement>(null);

  const content = triggerContent[trigger] ?? triggerContent.general;

  // Validation functions
  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) {
      return 'Email is required';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return 'Please enter a valid email address';
    }
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) {
      return 'Password is required';
    }
    if (mode === 'signup') {
      if (value.length < 8) {
        return 'Password must be at least 8 characters';
      }
      if (!/[A-Za-z]/.test(value)) {
        return 'Password must contain at least one letter';
      }
      if (!/[0-9]/.test(value)) {
        return 'Password must contain at least one number';
      }
    }
    return undefined;
  };

  const validateForm = (): boolean => {
    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);

    setFieldErrors({
      email: emailError,
      password: passwordError,
    });

    setTouched({ email: true, password: true });

    return !emailError && !passwordError;
  };

  const handleBlur = (field: 'email' | 'password') => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (field === 'email') {
      setFieldErrors((prev) => ({ ...prev, email: validateEmail(email) }));
    } else {
      setFieldErrors((prev) => ({ ...prev, password: validatePassword(password) }));
    }
  };

  // Scroll to top when modal opens
  useEffect(() => {
    if (open && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [open]);

  // Reset validation state when mode changes
  useEffect(() => {
    setFieldErrors({});
    setTouched({});
    setError(null);
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'signup' && onEmailSignup) {
        await onEmailSignup(email, password, name || undefined);
      } else if (mode === 'login' && onEmailLogin) {
        await onEmailLogin(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Extended features list for the sidebar
  const allFeatures = [
    'Unlimited conversations',
    'Create custom companions',
    'Voice chat support',
    'Video chat (coming soon)',
    'Image generation',
    'Saved conversation history',
    'Personality customization',
    'Play games together',
    'Group conversations',
    'Companion backstories',
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Custom overlay with animated companion background */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 sm:bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <MiniCompanionBackground />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content
          ref={contentRef}
          data-testid="signup-modal"
          className="fixed left-0 right-0 top-0 bottom-0 sm:left-[50%] sm:top-[50%] sm:bottom-auto sm:right-auto z-50 sm:translate-x-[-50%] sm:translate-y-[-50%] sm:max-w-md lg:max-w-4xl lg:min-w-[56rem] rounded-none sm:rounded-3xl border-0 bg-gradient-to-b from-background to-muted/30 p-0 overflow-hidden sm:max-h-[90vh] overflow-y-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95"
        >
          {/* Close button */}
          <DialogPrimitive.Close
            data-testid="signup-modal-close"
            className="absolute right-4 top-4 z-10 rounded-full p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        <div className="flex flex-col lg:flex-row">
          {/* Left side - Form */}
          <div className="flex-1 lg:w-1/2">
            {/* Header with Logo */}
            <div className="relative pt-8 pb-4 px-6 bg-gradient-to-b from-campfire-500/10 to-transparent">
              <DialogHeader className="text-center sm:text-center">
                {/* Animated Logo */}
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="mx-auto mb-6 flex items-center justify-center gap-2"
                >
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', duration: 0.8, bounce: 0.5, delay: 0.1 }}
                  >
                    <AnimatedFlame size="lg" />
                  </motion.div>
                </motion.div>
                <DialogTitle className="text-2xl font-bold">
                  {mode === 'signup' ? content.title : 'Welcome Back'}
                </DialogTitle>
                <DialogDescription className="text-base text-muted-foreground">
                  {mode === 'signup'
                    ? content.description
                    : 'Sign in to continue your conversations'
                  }
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="px-6 pb-6">
              {/* Tab Switcher */}
              <div className="flex rounded-2xl bg-muted/50 p-1.5 mb-6" data-testid="signup-modal-tabs">
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  data-testid="signup-modal-signup-tab"
                  className={cn(
                    'flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all duration-200',
                    mode === 'signup'
                      ? 'bg-background text-foreground shadow-md'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Sign Up
                </button>
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  data-testid="signup-modal-login-tab"
                  className={cn(
                    'flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all duration-200',
                    mode === 'login'
                      ? 'bg-background text-foreground shadow-md'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Log In
                </button>
              </div>

              {/* Google Sign-in */}
              <GoogleSignInButton
                onSuccess={onGoogleSuccess}
                onError={onGoogleError}
                text={mode === 'signup' ? 'signup' : 'signin'}
                className="w-full h-14 rounded-2xl text-base font-medium"
              />

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/50" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-3 text-muted-foreground rounded-full">
                    or
                  </span>
                </div>
              </div>

              {/* Email/Password Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (touched.email) {
                        setFieldErrors((prev) => ({ ...prev, email: validateEmail(e.target.value) }));
                      }
                    }}
                    onBlur={() => handleBlur('email')}
                    disabled={isSubmitting}
                    className={cn(
                      "rounded-xl h-11 bg-muted/30 border-border/50 focus:border-campfire-500",
                      touched.email && fieldErrors.email && "border-destructive focus:border-destructive"
                    )}
                  />
                  {touched.email && fieldErrors.email && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors.email}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={mode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (touched.password) {
                          setFieldErrors((prev) => ({ ...prev, password: validatePassword(e.target.value) }));
                        }
                      }}
                      onBlur={() => handleBlur('password')}
                      disabled={isSubmitting}
                      className={cn(
                        "rounded-xl h-11 bg-muted/30 border-border/50 focus:border-campfire-500 pr-10",
                        touched.password && fieldErrors.password && "border-destructive focus:border-destructive"
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isSubmitting}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                  {touched.password && fieldErrors.password && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors.password}</p>
                  )}
                </div>

                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-xl"
                  >
                    {error}
                  </motion.p>
                )}

                <Button
                  type="submit"
                  data-testid="signup-modal-submit"
                  className="w-full h-12 rounded-2xl text-base font-semibold bg-campfire-500 hover:bg-campfire-600 shadow-md shadow-campfire-500/20"
                  disabled={isSubmitting || !email || !password}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {mode === 'signup' ? 'Create Account' : 'Sign In'}
                </Button>
              </form>

            </div>
          </div>

          {/* Right side - Features (desktop only, signup mode only) */}
          {mode === 'signup' && (
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-center border-l border-border/30 px-8 py-10 bg-gradient-to-br from-campfire-500/5 to-campfire-600/10">
              <h3 className="text-lg font-bold mb-2">What you'll get</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Unlock the full Ignite experience
              </p>
              <div className="space-y-3">
                {allFeatures.map((feature) => (
                  <div key={feature} className="flex items-center gap-3">
                    <div className="flex-shrink-0 h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    </div>
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
