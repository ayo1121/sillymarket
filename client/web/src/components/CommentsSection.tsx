import { useState, useEffect } from "react";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { z } from "zod";

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
  const { isAuthenticated } = useWalletIdentity();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [lastCommentTime, setLastCommentTime] = useState(0);

  const fetchComments = async () => {
    setFetchLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:8787"}/comments?marketId=${encodeURIComponent(marketId)}`,
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
  };

  useEffect(() => {
    fetchComments();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchComments, 5000);
    return () => clearInterval(interval);
  }, [marketId]);

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
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:8787"}/comments`,
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
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.error || `Failed to post comment: ${res.statusText}`);
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
    } catch (err: any) {
      console.error("Error posting comment:", err);
      setError(err?.message || "Failed to post comment");
      toast({
        title: "Error posting comment",
        description: err?.message || "Failed to post comment",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const shortenWallet = (address: string) => {
    return address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "";
  };

  return (
    <div className="win95-window bg-background p-1">
      <div className="bg-primary text-primary-foreground px-3 py-2 mb-1">
        <span className="font-black text-sm tracking-tight">comments ({comments.length})</span>
      </div>
      
      <div className="win95-sunken bg-background p-4 space-y-4">
        {isAuthenticated ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="share your prediction..."
              className="win95-sunken font-bold resize-none"
              rows={3}
              maxLength={500}
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground font-bold">
                {newComment.length}/500
              </span>
              <Button
                type="submit"
                disabled={loading || !newComment.trim()}
                className="font-black"
              >
                {loading ? "posting..." : "post comment"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="win95-sunken bg-input p-4 text-center">
            <p className="text-sm font-bold text-muted-foreground">
              Connect your wallet to comment
            </p>
          </div>
        )}

        {error && (
          <div className="win95-sunken bg-destructive/10 p-2 text-center">
            <p className="text-xs font-bold text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {fetchLoading && comments.length === 0 ? (
            <div className="win95-sunken bg-input p-4 text-center">
              <p className="text-sm font-bold text-muted-foreground">loading comments...</p>
            </div>
          ) : comments.length === 0 ? (
            <div className="win95-sunken bg-input p-4 text-center">
              <p className="text-sm font-bold text-muted-foreground">
                no comments yet. be the first!
              </p>
            </div>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="win95-raised p-3 bg-background">
                <div className="flex justify-between items-start mb-2">
                  <span className="win95-sunken px-2 py-1 bg-input font-mono text-xs">
                    {comment.username || shortenWallet(comment.walletAddress)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-bold">
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
                <p className="font-bold text-sm">{comment.commentText}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
