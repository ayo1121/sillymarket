/**
 * Silly Character Widget
 * 
 * A floating chat button that opens a modal for interacting with the 
 * AI-powered Silly Character mascot.
 * 
 * Only renders when VITE_ENABLE_SILLY_CHARACTER=true
 */

import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import { API_URL, ENABLE_SILLY_CHARACTER } from '@/lib/config';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

interface ChatResponse {
    sessionId: string;
    reply: string;
    disabled?: boolean;
}

const STORAGE_KEY = 'silly-character-session-id';

export function SillyCharacterWidget() {
    // Don't render if feature is disabled
    if (!ENABLE_SILLY_CHARACTER) {
        return null;
    }

    return <SillyCharacterWidgetInner />;
}

function SillyCharacterWidgetInner() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Load session ID from localStorage
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            setSessionId(stored);
        }
    }, []);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Add welcome message on first open
    useEffect(() => {
        if (isOpen && messages.length === 0) {
            setMessages([
                {
                    id: 'welcome',
                    role: 'assistant',
                    content: "hey there! 👋 i'm silly, your sillymarket helper. ask me anything about creating markets, placing bets, or how things work around here!"
                }
            ]);
        }
    }, [isOpen, messages.length]);

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim()
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${API_URL}/api/silly-character/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    sessionId,
                    message: userMessage.content
                })
            });

            if (!response.ok) {
                throw new Error('Failed to send message');
            }

            const data: ChatResponse = await response.json();

            // Store session ID
            if (data.sessionId && data.sessionId !== sessionId) {
                setSessionId(data.sessionId);
                localStorage.setItem(STORAGE_KEY, data.sessionId);
            }

            // Add assistant message
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: data.reply
            }]);

        } catch (err) {
            console.error('Chat error:', err);
            setError('oops, something went wrong. try again?');
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: "hmm, i'm having trouble connecting right now. try again in a moment? 🔌"
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <>
            {/* Floating Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-20 right-4 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-[#15a349] to-[#0d7a35] text-white shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center hover:scale-105 active:scale-95"
                    aria-label="Open Silly Character chat"
                >
                    <MessageCircle className="w-6 h-6" />
                </button>
            )}

            {/* Chat Modal */}
            {isOpen && (
                <div className="fixed bottom-20 right-4 z-50 w-80 sm:w-96 h-[28rem] bg-white dark:bg-[#1f1f1f] rounded-lg shadow-2xl border-2 border-[#8b8b8b] dark:border-[#3a3a3a] flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#15a349] to-[#0d7a35] text-white">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🤖</span>
                            <span className="font-bold">Silly</span>
                            <span className="text-xs opacity-80">• helper</span>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1 hover:bg-white/20 rounded transition-colors"
                            aria-label="Close chat"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#f5f5f5] dark:bg-[#161616]">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${message.role === 'user'
                                            ? 'bg-[#15a349] text-white rounded-br-none'
                                            : 'bg-white dark:bg-[#2a2a2a] text-gray-800 dark:text-gray-200 rounded-bl-none border border-[#ddd] dark:border-[#3a3a3a]'
                                        }`}
                                >
                                    {message.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white dark:bg-[#2a2a2a] px-3 py-2 rounded-lg rounded-bl-none border border-[#ddd] dark:border-[#3a3a3a]">
                                    <Loader2 className="w-4 h-4 animate-spin text-[#15a349]" />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Error Banner */}
                    {error && (
                        <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
                            {error}
                        </div>
                    )}

                    {/* Input */}
                    <div className="p-3 bg-white dark:bg-[#1f1f1f] border-t border-[#ddd] dark:border-[#3a3a3a]">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Ask me anything..."
                                className="flex-1 px-3 py-2 text-sm border border-[#ccc] dark:border-[#444] rounded-lg bg-transparent focus:outline-none focus:border-[#15a349] dark:focus:border-[#15a349]"
                                disabled={isLoading}
                            />
                            <button
                                onClick={sendMessage}
                                disabled={!input.trim() || isLoading}
                                className="px-3 py-2 bg-[#15a349] text-white rounded-lg hover:bg-[#0d7a35] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                aria-label="Send message"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 text-center">
                            Silly can't verify facts or give financial advice
                        </p>
                    </div>
                </div>
            )}
        </>
    );
}

export default SillyCharacterWidget;
