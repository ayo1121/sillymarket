import React, { useState, useEffect, useRef } from 'react';
import { Search, X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { UIMarket } from '@/solana/marketMapping';
import { cn } from '@/lib/utils';

interface MarketSearchProps {
    markets: UIMarket[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export const MarketSearch: React.FC<MarketSearchProps> = ({
    markets,
    value,
    onChange,
    className,
}) => {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [suggestions, setSuggestions] = useState<UIMarket[]>([]);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (value.trim().length > 0) {
            const lowerValue = value.toLowerCase();
            const matches = markets
                .filter(m =>
                    m.displayQuestion.toLowerCase().includes(lowerValue) ||
                    m.pubkey.toLowerCase().includes(lowerValue)
                )
                .slice(0, 5); // Limit to 5 suggestions
            setSuggestions(matches);
            setIsOpen(matches.length > 0);
        } else {
            setSuggestions([]);
            setIsOpen(false);
        }
    }, [value, markets]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setFocusedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setFocusedIndex(prev => (prev > -1 ? prev - 1 : -1));
        } else if (e.key === 'Enter') {
            if (focusedIndex >= 0 && suggestions[focusedIndex]) {
                e.preventDefault();
                handleSelect(suggestions[focusedIndex]);
            } else {
                // Default enter behavior (submit search) - already handled by parent usually, 
                // but here we just close the dropdown
                setIsOpen(false);
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
            setFocusedIndex(-1);
        }
    };

    const handleSelect = (market: UIMarket) => {
        navigate(`/market/${market.pubkey}`);
        setIsOpen(false);
        onChange(''); // Optional: clear search after navigation? Or keep it? 
        // Usually clearing is better if we navigated away. 
        // But if we stay on page, maybe keep it.
        // Since we navigate, let's clear it to reset state if they come back? 
        // Actually, if we navigate, this component unmounts (if on different page).
        // But here we are on Index.tsx.
    };

    return (
        <div ref={wrapperRef} className={cn("relative", className)}>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-[#c7c7c7]" />
                <input
                    type="text"
                    placeholder="search markets..."
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => {
                        if (value.trim().length > 0 && suggestions.length > 0) {
                            setIsOpen(true);
                        }
                    }}
                    className="w-full win95-sunken bg-background dark:bg-[#1f1f1f] font-bold pl-10 pr-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all rounded"
                />
                {value.length > 0 && (
                    <button
                        onClick={() => onChange('')}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground dark:text-[#c7c7c7] dark:hover:text-white"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isOpen && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-background dark:bg-[#1f1f1f] border-2 border-foreground dark:border-[#3a3a3a] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded">
                    <div className="bg-primary text-primary-foreground px-2 py-1 text-xs font-bold flex justify-between items-center">
                        <span>suggestions</span>
                        <span className="text-[10px] opacity-80">press enter to select</span>
                    </div>
                    <ul className="max-h-60 overflow-y-auto py-1">
                        {suggestions.map((market, index) => (
                            <li
                                key={market.pubkey}
                                className={cn(
                                    "px-3 py-2 cursor-pointer flex items-center justify-between gap-2 group",
                                    index === focusedIndex ? "bg-primary/10" : "hover:bg-primary/5 dark:hover:bg-[#2a2a2a]"
                                )}
                                onClick={() => handleSelect(market)}
                                onMouseEnter={() => setFocusedIndex(index)}
                            >
                                <div className="flex flex-col min-w-0">
                                    <span className="font-bold truncate text-sm text-foreground dark:text-white">{market.displayQuestion}</span>
                                    <span className="text-xs text-muted-foreground dark:text-[#c7c7c7] truncate font-mono">
                                        {market.pubkey.slice(0, 8)}...
                                    </span>
                                </div>
                                <ArrowRight className={cn(
                                    "w-4 h-4 text-muted-foreground dark:text-[#c7c7c7] opacity-0 transition-opacity",
                                    index === focusedIndex ? "opacity-100" : "group-hover:opacity-100"
                                )} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};
