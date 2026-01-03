'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Flame, TrendingUp, Clock } from 'lucide-react';
import type { TemplateSortBy } from '@/stores/gifts-store';

interface SortOption {
  value: TemplateSortBy;
  label: string;
  icon: React.ReactNode;
}

const sortOptions: SortOption[] = [
  { value: 'popular', label: 'Most Popular', icon: <Flame className="h-3.5 w-3.5" /> },
  { value: 'trending', label: 'Trending', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { value: 'recent', label: 'Recently Added', icon: <Clock className="h-3.5 w-3.5" /> },
];

interface GiftSortDropdownProps {
  value: TemplateSortBy;
  onChange: (value: TemplateSortBy) => void;
}

export function GiftSortDropdown({ value, onChange }: GiftSortDropdownProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[140px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sortOptions.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            <div className="flex items-center gap-2">
              {option.icon}
              <span>{option.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
