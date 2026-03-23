'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, X, MessageCircle, User, Loader2 } from 'lucide-react';
import { searchSessions, SessionSearchResult } from '@/lib/api/sessions';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/date';

interface SessionSearchProps {
  className?: string;
}

/**
 * Highlights text within a snippet based on highlight positions
 */
function HighlightedSnippet({
  snippet,
  highlight,
}: {
  snippet: string;
  highlight: { start: number; end: number } | null;
}) {
  if (!highlight || highlight.start >= snippet.length) {
    return <span>{snippet}</span>;
  }

  const before = snippet.slice(0, highlight.start);
  const match = snippet.slice(highlight.start, highlight.end);
  const after = snippet.slice(highlight.end);

  return (
    <span>
      {before}
      <mark className="bg-primary/30 text-foreground rounded px-0.5">{match}</mark>
      {after}
    </span>
  );
}

export function SessionSearch({ className }: SessionSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Search query
  const {
    data: searchResults,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['session-search', debouncedQuery],
    queryFn: () => searchSessions({ q: debouncedQuery, limit: 10 }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000, // 30 seconds
  });

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setIsOpen(true);
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setIsOpen(false);
  }, []);

  const handleResultClick = useCallback(
    (sessionId: string) => {
      router.push(`/chat/${sessionId}`);
      setIsOpen(false);
      setQuery('');
    },
    [router]
  );

  const handleInputFocus = useCallback(() => {
    if (query.length >= 2) {
      setIsOpen(true);
    }
  }, [query]);

  const handleInputBlur = useCallback(() => {
    setIsOpen(false);
  }, []);

  const showResults = isOpen && debouncedQuery.length >= 2;
  const hasResults = searchResults?.results && searchResults.results.length > 0;

  return (
    <div className={cn('relative', className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search conversations..."
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          className="pl-9 pr-9"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={handleClear}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {(isLoading || isFetching) && debouncedQuery.length >= 2 && (
          <Loader2 className="absolute right-10 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (
        <Card className="absolute z-50 w-full mt-2 shadow-lg border-primary/20 bg-background/95 backdrop-blur-xl max-h-[400px] overflow-auto">
          <CardContent className="p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : hasResults ? (
              <div className="space-y-1">
                {searchResults.results.map((result) => (
                  <SearchResultItem
                    key={result.sessionId}
                    result={result}
                    onClick={() => handleResultClick(result.sessionId)}
                  />
                ))}
                {searchResults.hasMore && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Showing {searchResults.results.length} of {searchResults.total} results
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Search className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No results found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try a different search term
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Individual search result item
 */
function SearchResultItem({
  result,
  onClick,
}: {
  result: SessionSearchResult;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="w-full p-3 rounded-lg hover:bg-accent/50 transition-colors text-left flex items-start gap-3"
    >
      {/* Avatar */}
      <Avatar className="h-10 w-10 shrink-0">
        {result.companionAvatarUrl ? (
          <AvatarImage src={result.companionAvatarUrl} alt={result.companionName} />
        ) : null}
        <AvatarFallback className="bg-primary/20">
          <User className="h-5 w-5" />
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{result.companionName}</span>
          {result.matchType === 'message' && (
            <MessageCircle className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
        </div>

        {/* Snippet */}
        <p className="text-sm text-muted-foreground truncate mt-0.5">
          {result.matchType === 'companion' ? (
            <span className="italic">Companion name matches</span>
          ) : (
            <HighlightedSnippet
              snippet={result.snippet}
              highlight={result.snippetHighlight}
            />
          )}
        </p>

        {/* Meta */}
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>{result.turnCount} messages</span>
          <span>-</span>
          <span>{formatRelativeTime(result.lastActivityAt)}</span>
          {result.sessionStatus === 'active' && (
            <span className="inline-flex items-center gap-1 text-green-500">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Active
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
