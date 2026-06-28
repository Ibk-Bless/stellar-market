"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { X } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const SUGGESTION_DEBOUNCE_MS = 200;

interface SkillSuggestion {
  id: string;
  name: string;
  category: string | null;
}

interface SkillComboboxProps {
  skills: string[];
  onChange: (skills: string[]) => void;
  maxSkills?: number;
  placeholder?: string;
}

/**
 * Skill input with taxonomy-backed autocomplete. Selecting a suggestion (or
 * pressing Enter on free text not in the taxonomy) adds a removable chip;
 * unmatched text is still accepted as a custom skill.
 */
export default function SkillCombobox({
  skills,
  onChange,
  maxSkills = 20,
  placeholder = "Add a skill (e.g., React, Node.js)",
}: SkillComboboxProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SkillSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/skills`, { params: { q: trimmed } });
        setSuggestions(res.data?.skills ?? []);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function addSkill(skill: string) {
    const trimmed = skill.trim();
    if (!trimmed) return;
    if (skills.length >= maxSkills) return;
    if (skills.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setQuery("");
      setOpen(false);
      return;
    }

    onChange([...skills, trimmed]);
    setQuery("");
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
  }

  function removeSkill(skill: string) {
    onChange(skills.filter((s) => s !== skill));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const selected = activeIndex >= 0 ? suggestions[activeIndex]?.name : query;
      addSkill(selected ?? query);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        className="input-field w-full"
        placeholder={placeholder}
        maxLength={50}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
      />

      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-theme-card border border-theme-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {suggestions.map((suggestion, idx) => (
            <li key={suggestion.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addSkill(suggestion.name)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-theme-border/40 ${
                  idx === activeIndex ? "bg-theme-border/40" : ""
                }`}
              >
                <span className="text-theme-text">{suggestion.name}</span>
                {suggestion.category && (
                  <span className="text-theme-text/60 text-xs">{suggestion.category}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {skills.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {skills.map((skill) => (
            <span
              key={skill}
              className="px-3 py-1.5 bg-theme-card border border-theme-border rounded-full text-sm text-theme-text flex items-center gap-2"
            >
              {skill}
              <button
                type="button"
                onClick={() => removeSkill(skill)}
                className="text-theme-error hover:text-theme-error/80"
                aria-label={`Remove ${skill}`}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
