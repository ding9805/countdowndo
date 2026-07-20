'use client';

import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  existingTags: string[];
  /** Controlled value of the not-yet-committed input text, owned by the parent
   *  so it can be flushed into `tags` on form submit. */
  inputValue: string;
  onInputChange: (value: string) => void;
  placeholder?: string;
}

// Adds `raw` to `tags` unless it's blank or a case-insensitive duplicate.
// Exported so form submit handlers can flush pending input text the same way.
export function mergePendingTag(tags: string[], raw: string): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return tags;
  if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return tags;
  return [...tags, trimmed];
}

export function TagInput({ tags, onChange, existingTags, inputValue, onInputChange, placeholder = 'Add a tag…' }: TagInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const setInputValue = onInputChange;

  // Show unused existing tags on focus (empty query) so the dropdown is a
  // pick-list of bank/goal tags; once the user types, filter by substring.
  const suggestions = existingTags.filter((t) => {
    if (tags.some((tag) => tag.toLowerCase() === t.toLowerCase())) return false;
    const q = inputValue.trim().toLowerCase();
    if (!q) return true;
    return t.toLowerCase().includes(q);
  }).slice(0, 12);

  const commitTag = (raw: string) => {
    const merged = mergePendingTag(tags, raw);
    if (merged !== tags) onChange(merged);
    setInputValue('');
    setShowSuggestions(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 bg-secondary/60 border border-border/50 rounded-lg px-2.5 py-2 focus-within:border-primary/50 transition-colors">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-xs font-medium px-2 py-0.5"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:text-primary-foreground hover:bg-primary/40 rounded-full"
              aria-label={`Remove tag ${tag}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setShowSuggestions(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s}
              onMouseDown={(e) => { e.preventDefault(); commitTag(s); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/60 text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
