'use client';

import { useState, useRef, useEffect } from 'react';

interface SelectorProps {
  label: string;
  options: string[];
  selected: string;
  onChange: (value: string) => void;
}

export default function Selector({ label, options, selected, onChange }: SelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClose = () => setIsOpen(false);

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleClose, { passive: true });
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleClose);
    };
  }, [isOpen]);


  return (
    <div className="relative flex flex-col gap-2 w-full" ref={containerRef}>
      <label className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[#666] ml-1">
        {label}
      </label>
      
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-5 py-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl hover:bg-white/[0.05] hover:border-white/[0.15] transition-all group"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-semibold">{selected || 'Select option'}</span>
        <svg 
          className={`w-4 h-4 text-[#666] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} 
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div 
          className="absolute top-[calc(100%+8px)] left-0 w-full card-glass p-1.5 z-[100] shadow-[0_20px_50px_rgba(0,0,0,0.5)] animate-fade-in"

          role="listbox"
        >
          {options.map((option) => (
            <button
              key={option}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-3.5 text-sm font-medium transition-all flex items-center justify-between group
                ${selected === option 
                  ? 'bg-white/[0.08] text-white' 
                  : 'text-[#666] hover:text-white hover:bg-white/[0.03]'}`}
            >
              <span>{option}</span>
              {selected === option && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-white animate-in zoom-in duration-300">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
