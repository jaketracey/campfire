'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useOnboardingStore } from '@/stores/onboarding-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';

const identitySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  pronouns: z.string().min(1, 'Please select or enter pronouns'),
  backstory: z.string().optional(),
});

type IdentityFormValues = z.infer<typeof identitySchema>;

export function Step2Identity() {
  const { name, identity, setName, setIdentity, nextStep } = useOnboardingStore();

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<IdentityFormValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      name,
      pronouns: identity.pronouns,
      backstory: identity.backstory,
    },
    mode: 'onChange',
  });

  const onSubmit = (data: IdentityFormValues) => {
    setName(data.name);
    setIdentity({
      pronouns: data.pronouns,
      backstory: data.backstory || '',
    });
    nextStep();
  };

  return (
    <Card className="w-full bg-white/[0.01] backdrop-blur-3xl border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-vibes-neon via-vibes-hot to-vibes-cyan" />
      <CardHeader className="space-y-2 pb-8">
        <CardTitle className="text-3xl font-bold font-display tracking-tight text-white">Identity</CardTitle>
        <CardDescription className="text-gray-400">
          Give your companion a name and a meaningful identity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          <div className="space-y-3">
            <Label htmlFor="name" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Name
            </Label>
            <Input
              id="name"
              placeholder="e.g. Atlas, Luna, Jarvis..."
              {...register('name')}
              className="bg-white/[0.03] border-white/10 h-14 text-lg focus:ring-vibes-neon focus:border-vibes-neon font-sans transition-all"
            />
            {errors.name && (
              <p className="text-sm text-vibes-hot font-medium">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="pronouns" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Pronouns
            </Label>
            <Input
              id="pronouns"
              placeholder="e.g. they/them, she/her..."
              {...register('pronouns')}
              className="bg-white/[0.03] border-white/10 h-14 text-lg focus:ring-vibes-cyan focus:border-vibes-cyan transition-all"
            />
            {errors.pronouns && (
              <p className="text-sm text-vibes-hot font-medium">{errors.pronouns.message}</p>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="backstory" className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
              Backstory (Optional)
            </Label>
            <Textarea
              id="backstory"
              placeholder="Briefly describe who they are... (e.g. A digital librarian from the 22nd century)"
              {...register('backstory')}
              className="min-h-[120px] bg-white/[0.03] border-white/10 text-lg focus:ring-vibes-electric focus:border-vibes-electric transition-all"
            />
          </div>

          <div className="pt-6 flex justify-end">
            <Button
              type="submit"
              size="lg"
              disabled={!isValid}
              className="group h-14 px-10 rounded-full bg-gradient-to-r from-vibes-electric to-vibes-cyan hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] transition-all font-bold text-lg"
            >
              Next: Visuals
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-2 transition-transform duration-300" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
