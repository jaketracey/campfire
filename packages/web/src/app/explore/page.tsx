'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Search, Compass } from 'lucide-react';
import { CompanionCard } from '@/components/explore/companion-card';
import { FEATURED_COMPANIONS, CATEGORIES } from '@/data/featured-companions';
import { useCompanionFilter } from '@/hooks/use-companion-filter';

export default function ExplorePage() {
  const {
    activeCategory,
    setActiveCategory,
    searchQuery,
    setSearchQuery,
    filteredCompanions,
  } = useCompanionFilter({ companions: FEATURED_COMPANIONS });

  return (
    <div className="w-full py-8 sm:py-12 px-4 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8 max-w-7xl mx-auto"
      >
        {/* Hero section */}
        <div className="text-center space-y-3">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="flex items-center justify-center gap-2 mb-4"
          >
            <Compass className="h-5 w-5 text-campfire-500" />
            <span className="text-xs font-bold tracking-widest uppercase text-campfire-500">
              Explore
            </span>
          </motion.div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold font-display text-white tracking-tight">
            Meet Someone New
          </h1>
          <p className="text-base sm:text-lg text-gray-400 max-w-md mx-auto">
            Browse companions ready to chat. No setup required.
          </p>
        </div>

        {/* Search bar */}
        <div className="max-w-md mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name or trait..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-full bg-white/[0.05] border border-white/10 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all"
              data-testid="explore-search"
            />
          </div>
        </div>

        {/* Category filter pills */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {CATEGORIES.map((category) => (
            <button
              key={category.value}
              onClick={() => setActiveCategory(category.value)}
              data-testid={`filter-${category.value}`}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                activeCategory === category.value
                  ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.15)]'
                  : 'bg-white/[0.05] text-gray-400 border border-white/10 hover:bg-white/[0.1] hover:text-white'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>

        {/* Companion grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeCategory + searchQuery}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {filteredCompanions.length > 0 ? (
              <div
                className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
                data-testid="companion-grid"
              >
                {filteredCompanions.map((companion, idx) => (
                  <CompanionCard
                    key={companion.id}
                    companion={companion}
                    index={idx}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-gray-500 text-lg">
                  No companions match your search. Try a different filter.
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
