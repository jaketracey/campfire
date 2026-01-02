'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface IdentityDisplayProps {
  name: string;
  pronouns: string;
  backstory: string;
  onComplete: () => void;
}

export function IdentityDisplay({ name, pronouns, backstory, onComplete }: IdentityDisplayProps) {
  const [displayedName, setDisplayedName] = useState('');
  const [displayedPronouns, setDisplayedPronouns] = useState('');
  const [displayedBackstory, setDisplayedBackstory] = useState('');
  const [nameHighlight, setNameHighlight] = useState(false);
  const [pronounsHighlight, setPronounsHighlight] = useState(false);
  const [backstoryHighlight, setBackstoryHighlight] = useState(false);

  useEffect(() => {
    // Type out name character by character
    let nameIndex = 0;
    const nameInterval = setInterval(() => {
      if (nameIndex <= name.length) {
        setDisplayedName(name.slice(0, nameIndex));
        nameIndex++;
      } else {
        clearInterval(nameInterval);
        setNameHighlight(true);
        setTimeout(() => setNameHighlight(false), 400);
      }
    }, 60);

    // Start pronouns after name
    const pronounsTimeout = setTimeout(() => {
      let pronounsIndex = 0;
      const pronounsInterval = setInterval(() => {
        if (pronounsIndex <= pronouns.length) {
          setDisplayedPronouns(pronouns.slice(0, pronounsIndex));
          pronounsIndex++;
        } else {
          clearInterval(pronounsInterval);
          setPronounsHighlight(true);
          setTimeout(() => setPronounsHighlight(false), 400);
        }
      }, 50);
    }, name.length * 60 + 200);

    // Start backstory after pronouns
    const backstoryTimeout = setTimeout(() => {
      setBackstoryHighlight(true);
      // Show backstory all at once with fade
      setDisplayedBackstory(backstory);
      setTimeout(() => {
        setBackstoryHighlight(false);
        // Complete after all animations
        setTimeout(onComplete, 400);
      }, 600);
    }, name.length * 60 + pronouns.length * 50 + 500);

    return () => {
      clearInterval(nameInterval);
      clearTimeout(pronounsTimeout);
      clearTimeout(backstoryTimeout);
    };
  }, [name, pronouns, backstory, onComplete]);

  const getHighlightStyle = (isHighlighted: boolean) => ({
    background: isHighlighted
      ? 'rgba(168, 85, 247, 0.15)'
      : 'rgba(255, 255, 255, 0.03)',
  });

  return (
    <Card className="w-full bg-white/[0.01] backdrop-blur-3xl border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden">
      <CardHeader className="space-y-2 pb-6">
        <div>
          <CardTitle className="text-3xl font-bold font-display tracking-tight text-white">Identity</CardTitle>
          <CardDescription className="text-gray-400 mt-2">
            Give your companion a name and identity
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
            Name
          </Label>
          <motion.div
            animate={getHighlightStyle(nameHighlight)}
            transition={{ duration: 0.3 }}
            className="rounded-lg"
          >
            <Input
              value={displayedName}
              readOnly
              className="bg-white/[0.03] border-white/10 h-14 md:h-16 text-lg md:text-xl font-sans transition-all pointer-events-none"
            />
          </motion.div>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
            Pronouns
          </Label>
          <motion.div
            animate={getHighlightStyle(pronounsHighlight)}
            transition={{ duration: 0.3 }}
            className="rounded-lg"
          >
            <Input
              value={displayedPronouns}
              readOnly
              className="bg-white/[0.03] border-white/10 h-14 md:h-16 text-lg md:text-xl transition-all pointer-events-none"
            />
          </motion.div>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-bold tracking-widest uppercase text-gray-500 font-display">
            Backstory
          </Label>
          <motion.div
            animate={getHighlightStyle(backstoryHighlight)}
            transition={{ duration: 0.3 }}
            className="rounded-lg"
          >
            <Textarea
              value={displayedBackstory}
              readOnly
              className="min-h-[120px] md:min-h-[150px] bg-white/[0.03] border-white/10 text-lg md:text-xl transition-all pointer-events-none scrollbar-subtle"
            />
          </motion.div>
        </div>
      </CardContent>
    </Card>
  );
}
