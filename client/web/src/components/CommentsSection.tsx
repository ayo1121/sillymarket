import { useState, useEffect } from "react";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { z } from "zod";
import { API_URL } from "@/lib/config";
import { shortenWallet } from "@/utils/format";

type Comment = {
  id: string;
  marketId: string;
  commentText: string;
  createdAt: string;        // ISO string
  username: string | null;
  walletAddress: string;
};

interface CommentsSectionProps {
  marketId: string;
}

export const CommentsSection = ({ marketId }: CommentsSectionProps) => {
  const { isAuthenticated, pubkey: walletPubkey } = useWalletIdentity();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [lastCommentTime, setLastCommentTime] = useState(0);


  const fetchComments = useCallback(async () => {
    setFetchLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/comments?marketId=${encodeURIComponent(marketId)}`,
        {
          credentials: "include",
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch comments: ${res.statusText}`);
      }

      const data = await res.json();
      setComments(data.comments || []);
    } catch (err: any) {
      console.error("Error fetching comments:", err);
      setError(err?.message || "Failed to load comments");
    } finally {
      setFetchLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    fetchComments();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchComments, 5000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      toast({
        title: "Wallet connection required",
        description: "Connect your wallet to comment",
        variant: "destructive",
      });
      return;
    }

    // Rate limiting check
    const MIN_COMMENT_INTERVAL = 5000; // 5 seconds
    const timeSinceLastComment = Date.now() - lastCommentTime;

    if (timeSinceLastComment < MIN_COMMENT_INTERVAL) {
      const waitTime = Math.ceil((MIN_COMMENT_INTERVAL - timeSinceLastComment) / 1000);
      toast({
        title: "Slow down!",
        description: `Please wait ${waitTime} more second${waitTime !== 1 ? 's' : ''} before posting another comment`,
        variant: "destructive",
      });
      return;
    }

    // Validate input using zod
    const commentSchema = z.object({
      commentText: z.string()
        .trim()
        .min(1, "Comment cannot be empty")
        .max(500, "Comment must be less than 500 characters"),
      marketId: z.string().min(1, "Market ID is required")
    });

    const validationResult = commentSchema.safeParse({
      commentText: newComment,
      marketId: marketId
    });

    if (!validationResult.success) {
      toast({
        title: "Validation Error",
        description: validationResult.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Try backend API first
      const res = await fetch(
        `${API_URL}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            marketId: validationResult.data.marketId,
            commentText: validationResult.data.commentText
          }),
        }
      );

      if (!res.ok) {
        throw new Error("Backend API failed");
      }

      const data = await res.json();

      // The API returns a single comment object, prepend it to the list
      setComments((prev) => [data, ...prev]);
      setNewComment("");
      setLastCommentTime(Date.now());

      toast({
        title: "Comment posted!",
        description: "Your comment has been added.",
      });
    } catch (backendError: any) {
      console.warn("[CommentsSection] Backend API failed, trying Supabase direct write:", backendError);

      // Fallback to Supabase direct write
      try {
        const { postComment } = await import("@/integrations/supabase/writes");
        const { supabase } = await import("@/integrations/supabase/client");

        if (!walletPubkey) {
          throw new Error("Wallet not connected");
        }

        // Get user ID from Supabase users table
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('pubkey', walletPubkey)
          .single();

        if (!userData?.id) {
          throw new Error("User not found in database. Please reconnect your wallet.");
        }

        await postComment({
          marketId: validationResult.data.marketId,
          userId: userData.id,
          commentText: validationResult.data.commentText,
        });

        // Refresh comments list
        await fetchComments();
        setNewComment("");
        setLastCommentTime(Date.now());

        toast({
          title: "Comment posted!",
          description: "Your comment has been added.",
        });
      } catch (supabaseError: any) {
        console.error("Error posting comment (both backend and Supabase failed):", supabaseError);
        setError(supabaseError?.message || "Failed to post comment");
        toast({
          title: "Error posting comment",
          description: supabaseError?.message || "Failed to post comment",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-4 sm:p-5 relative overflow-hidden">
      {/* Faint smiley watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[140px] font-black text-gray-400 select-none">
        : )
      </div>

      <div className="relative z-10">
        {/* Header */}
        <h2 className="text-xs uppercase font-black tracking-wider text-[#555] dark:text-[#c7c7c7] mb-4 pb-2 border-b-2 border-[#d3d3d3] dark:border-[#333]">
          Comments ({comments.length})
        </h2>

        <div className="space-y-4">
          {isAuthenticated ? (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="share your prediction..."
                className="border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded font-semibold resize-none focus:border-[#111] transition-colors bg-white dark:bg-[#1f1f1f] text-foreground dark:text-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.1)]"
                rows={3}
                maxLength={500}
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#666] dark:text-[#c7c7c7] font-semibold">
                  {newComment.length}/500
                </span>
                <Button
                  type="submit"
                  disabled={loading || !newComment.trim()}
                  className="font-bold shadow-md"
                >
                  {loading ? "posting..." : "post comment"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-[#d3d3d3] dark:border-[#333] rounded p-4 text-center shadow-sm">
              <p className="text-sm font-semibold text-[#666] dark:text-[#c7c7c7]">
                Connect your wallet to comment
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-[#3a0c0c] border-2 border-red-400 dark:border-red-700 rounded p-3 text-center shadow-sm">
              <p className="text-xs font-bold text-red-700 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {fetchLoading && comments.length === 0 ? (
              <div className="bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-[#d3d3d3] dark:border-[#333] rounded p-4 text-center shadow-sm">
                <p className="text-sm font-semibold text-[#666] dark:text-[#c7c7c7]">loading comments...</p>
              </div>
            ) : comments.length === 0 ? (
              <div className="bg-[#f5f5f5] dark:bg-[#1f1f1f] border border-[#d3d3d3] dark:border-[#333] rounded p-8 text-center shadow-sm">
                <div className="text-4xl mb-2 opacity-20">💬</div>
                <p className="text-sm font-semibold text-[#666] dark:text-[#c7c7c7]">
                  no comments yet. be the first!
                </p>
              </div>
            ) : (
              comments.map((comment, idx) => (
                <div
                  key={comment.id}
                  className={`border border-[#e0e0e0] dark:border-[#333] rounded p-3 shadow-sm ${idx % 2 === 0 ? 'bg-white dark:bg-[#1f1f1f]' : 'bg-[#fafafa] dark:bg-[#1a1a1a]'
                    }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="bg-[#f0f0f0] dark:bg-[#2a2a2a] border border-[#d3d3d3] dark:border-[#333] px-2 py-1 rounded font-mono text-xs font-bold text-[#111] dark:text-white">
                      {comment.username || shortenWallet(comment.walletAddress)}
                    </span>
                    <span className="text-[10px] text-[#999] dark:text-[#c7c7c7] font-semibold">
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="font-semibold text-sm text-[#111] dark:text-white leading-relaxed break-words">{comment.commentText}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
