'use client';

import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { GiftTemplateCategory } from '@/lib/api/gifts';

interface CategoryOption {
  value: GiftTemplateCategory | null;
  label: string;
  emoji: string;
}

const categories: CategoryOption[] = [
  { value: null, label: 'All', emoji: '✨' },
  { value: 'romantic', label: 'Romantic', emoji: '💕' },
  { value: 'friendship', label: 'Friendship', emoji: '🤝' },
  { value: 'celebration', label: 'Celebration', emoji: '🎉' },
  { value: 'comfort', label: 'Comfort', emoji: '🌸' },
  { value: 'gratitude', label: 'Gratitude', emoji: '🙏' },
  { value: 'playful', label: 'Playful', emoji: '🎮' },
  { value: 'mystical', label: 'Mystical', emoji: '🔮' },
  { value: 'nature', label: 'Nature', emoji: '🌿' },
  { value: 'artistic', label: 'Artistic', emoji: '🎨' },
  { value: 'thoughtful', label: 'Thoughtful', emoji: '💭' },
];

interface GiftCategoryFilterProps {
  selected: GiftTemplateCategory | null;
  onChange: (category: GiftTemplateCategory | null) => void;
}

export function GiftCategoryFilter({ selected, onChange }: GiftCategoryFilterProps) {
  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex gap-2 pb-2">
        {categories.map((category) => (
          <button
            key={category.value ?? 'all'}
            onClick={() => onChange(category.value)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              'border border-transparent',
              selected === category.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
            )}
          >
            <span>{category.emoji}</span>
            <span>{category.label}</span>
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
