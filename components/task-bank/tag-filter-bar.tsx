'use client';

import React from 'react';
import { Tag, X } from 'lucide-react';

interface TagFilterBarProps {
  allTags: string[];
  activeTags: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}

export function TagFilterBar({ allTags, activeTags, onToggle, onClear }: TagFilterBarProps) {
  if (allTags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      {allTags.map((tag) => {
        const active = activeTags.includes(tag);
        return (
          <button
            key={tag}
            onClick={() => onToggle(tag)}
            className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'bg-secondary/40 border-border/40 text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {tag}
          </button>
        );
      })}
      {activeTags.length > 0 && (
        <button
          onClick={onClear}
          className="text-xs font-medium px-2 py-1 rounded-full text-muted-foreground hover:text-destructive flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      )}
    </div>
  );
}
