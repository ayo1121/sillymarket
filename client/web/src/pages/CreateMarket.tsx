import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Upload, X, Plus, Trash2 } from "lucide-react";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { toast } from "sonner";
import { useAnchorProgram } from "@/solana/program";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { createMarket } from "@/solana/actions";
import { PublicKey } from "@solana/web3.js";
import { uploadMarketImage } from "@/integrations/supabase/storage";
import { useWalletIdentity } from "@/auth/walletIdentity";

const CreateMarket = () => {
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const anchorWallet = useAnchorWallet();
  const { username } = useWalletIdentity();

  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<string[]>(["Yes", "No"]);
  const [minutesFromNow, setMinutesFromNow] = useState<string>("60"); // Default to 60 minutes (1 hour)
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Log only when program state changes (not on every render)
  useEffect(() => {
    if (!program && publicKey) {
      console.warn("[CreateMarket] Wallet connected but program not loaded. Check browser console for [yesno] error logs.");
    }
  }, [program, publicKey]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("image must be less than 5mb");
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setImagePreview(dataUrl);
        // Image will be uploaded to Supabase Storage when form is submitted
        // For now, just show preview
        setImageUrl("");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageUrl("");
  };

  const addAnswer = () => {
    if (answers.length < 5) {
      setAnswers([...answers, ""]);
    } else {
      toast.error("Maximum 5 answers allowed");
    }
  };

  const removeAnswer = (index: number) => {
    if (answers.length > 2) {
      setAnswers(answers.filter((_, i) => i !== index));
    } else {
      toast.error("Minimum 2 answers required");
    }
  };

  const updateAnswer = (index: number, value: string) => {
    const newAnswers = [...answers];
    newAnswers[index] = value;
    setAnswers(newAnswers);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Early validation checks
    if (!program) {
      console.error("[CreateMarket] Program not loaded");
      toast.error("Program is loading. Please wait...");
      return;
    }

    if (!publicKey) {
      console.error("[CreateMarket] Wallet not connected");
      toast.error("Please connect your wallet first");
      return;
    }

    if (!question.trim()) {
      toast.error("Please enter a question");
      return;
    }

    // Validate answers
    const validAnswers = answers.filter(a => a.trim().length > 0);
    if (validAnswers.length < 2) {
      toast.error("Please provide at least 2 answers");
      return;
    }
    if (validAnswers.length > 5) {
      toast.error("Maximum 5 answers allowed");
      return;
    }

    // Check for duplicate answers (case-insensitive)
    const lowerAnswers = validAnswers.map(a => a.trim().toLowerCase());
    const uniqueAnswers = new Set(lowerAnswers);
    if (uniqueAnswers.size !== lowerAnswers.length) {
      toast.error("Answers must be unique");
      return;
    }

    // Validate lengths
    if (question.trim().length > 1024) {
      toast.error("Question must be 1024 characters or less");
      return;
    }
    for (const a of validAnswers) {
      if (a.length > 64) {
        toast.error("Each answer must be 64 characters or less");
        return;
      }
    }

    // Validate time input (must be at least 5 minutes, max 48 hours = 2880 minutes)
    const minutes = parseInt(minutesFromNow) || 0;

    if (minutes < 5) {
      toast.error("Market must end at least 5 minutes from now");
      return;
    }
    if (minutes > 48 * 60) {
      toast.error("Market must end within 48 hours (2880 minutes) from now");
      return;
    }

    // Calculate cutoff timestamp
    const now = Math.floor(Date.now() / 1000);
    const cutoffTs = now + (minutes * 60);

    setSubmitting(true);
    try {
      // Upload image to Supabase Storage if a file was selected
      let finalImageUrl = imageUrl.trim();
      if (imageFile) {
        try {
          console.log("[CreateMarket] Uploading image to Supabase Storage...");
          finalImageUrl = await uploadMarketImage(imageFile);
          console.log("[CreateMarket] Image uploaded successfully:", finalImageUrl.substring(0, 50) + "...");
        } catch (err: any) {
          console.error("[CreateMarket] Image upload failed:", err);
          const errorMsg = err?.message || "Failed to upload image";
          toast.error(errorMsg.includes("not configured")
            ? "Image upload not configured. Check Supabase settings in .env.local"
            : `Image upload failed: ${errorMsg}`);
          setSubmitting(false);
          return;
        }
      }

      // Derive clean answers array from form
      const rawAnswers = validAnswers.map(a => a.trim());
      const answers = rawAnswers
        .map((a) => (a || "").trim())
        .filter((a) => a.length > 0)
        .slice(0, 5);

      // 1) On-chain market creation (this IS critical)
      const { txSig, marketPubkey } = await createMarket(wallet, {
        cutoffTs: cutoffTs,
        question: question.trim(),
        answers,
        imageUrl: finalImageUrl || null,
      });

      console.log("[CreateMarket] Anchor tx success", { txSig, marketPubkey });

      // 2) Local metadata (still ok to keep)
      const creatorWallet = wallet.publicKey?.toBase58() ?? null;
      const createdAtIso = new Date().toISOString();

      const metadata = {
        marketPubkey,
        question: question.trim(),
        creatorWallet,
        description: null,
        imageUrl: finalImageUrl || null,
        creatorName: username ?? null,
        answers,
        createdAt: createdAtIso,
      };

      const { upsertLocalMarketMetadata } = await import("../lib/marketMetadata");
      upsertLocalMarketMetadata(metadata);

      // ⚠️ SECURITY NOTE: Frontend no longer writes to Supabase markets table
      // Market metadata is stored locally and read from on-chain data
      // If backend indexing is needed, it should be done via Edge Function/API
      console.log("[CreateMarket] Market metadata stored locally");


      // 4) Existing success UI: reset form, navigate, toast, etc.
      toast.success(`Market created! Transaction: ${txSig}`);
      navigate(`/market/${marketPubkey}`);
    } catch (error: any) {
      console.error("[CreateMarket] Anchor tx failed", error);
      console.error("Error details:", {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        code: error?.code,
        logs: error?.logs,
      });
      toast.error(error?.message || "Failed to create market");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-win95-teal">
      <Header />
      <div className="max-w-4xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
        <div className="win95-window bg-background p-1">
          <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={lightbulbIcon} alt="" className="w-4 h-4 sm:w-5 sm:h-5 opacity-80" />
              <span className="font-black tracking-tight text-xs sm:text-sm">create market</span>
            </div>
            <div className="flex gap-1">
              <div className="w-2 h-2 sm:w-3 sm:h-3 win95-raised bg-background"></div>
              <div className="w-2 h-2 sm:w-3 sm:h-3 win95-raised bg-background"></div>
              <div className="w-2 h-2 sm:w-3 sm:h-3 win95-raised bg-background"></div>
            </div>
          </div>

          <div className="win95-sunken bg-background p-4 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="question" className="font-black text-sm tracking-tight">
                  market question * (max 1024 chars)
                </Label>
                <Input
                  id="question"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="Will BTC hit $100k in 2025?"
                  className="win95-sunken font-bold"
                  required
                  maxLength={1024}
                />
              </div>

              <div className="space-y-2">
                <Label className="font-black text-sm tracking-tight">
                  answers * (2-5 options, max 64 chars each)
                </Label>
                <div className="space-y-2">
                  {answers.map((answer, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={answer}
                        onChange={e => updateAnswer(index, e.target.value)}
                        placeholder={`Answer ${index + 1}`}
                        className="win95-sunken font-bold flex-1"
                        maxLength={64}
                        required
                      />
                      {answers.length > 2 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => removeAnswer(index)}
                          className="win95-raised"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {answers.length < 5 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addAnswer}
                      className="win95-raised text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Answer
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-black text-sm tracking-tight">
                  end time * (5 min - 2880 min / 48 hours from now)
                </Label>
                <Input
                  type="number"
                  min="5"
                  max="2880"
                  value={minutesFromNow}
                  onChange={e => setMinutesFromNow(e.target.value)}
                  placeholder="60"
                  className="win95-sunken font-bold"
                  required
                />
                <p className="text-xs text-muted-foreground font-bold">
                  Market will end in {minutesFromNow || "0"} minutes from now
                  {(() => {
                    const m = parseInt(minutesFromNow) || 0;
                    if (m > 0) {
                      const endDate = new Date(Date.now() + m * 60 * 1000);
                      const hours = Math.floor(m / 60);
                      const mins = m % 60;
                      const timeStr = hours > 0 ? `${hours}h ${mins > 0 ? `${mins}m` : ""}`.trim() : `${mins}m`;
                      return ` (${timeStr} = ${format(endDate, "PPP p")})`;
                    }
                    return "";
                  })()}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="font-black text-sm tracking-tight">
                  market image (optional, max 200 chars URL)
                </Label>
                <div className="win95-sunken bg-input p-6">
                  {imagePreview ? (
                    <div className="relative">
                      <img src={imagePreview} alt="Market preview" className="w-full h-48 object-cover win95-sunken" />
                      <Button
                        type="button"
                        variant="primary"
                        size="icon"
                        className="absolute top-2 right-2 win95-raised"
                        onClick={handleRemoveImage}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <label htmlFor="image-upload" className="flex flex-col items-center justify-center cursor-pointer p-8 hover:bg-accent transition-colors">
                      <Upload className="h-12 w-12 mb-2 text-muted-foreground" />
                      <span className="font-black text-sm mb-1">click to upload image</span>
                      <span className="text-xs text-muted-foreground font-bold">
                        max 5mb • jpg, png, gif
                      </span>
                      <input
                        id="image-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageChange}
                      />
                    </label>
                  )}
                </div>
                {imagePreview && (
                  <p className="text-xs text-gray-600 mt-2">
                    Image will be uploaded to Supabase Storage when you create the market.
                  </p>
                )}
              </div>

              <div className="win95-sunken bg-input p-4">
                <div className="flex items-start gap-3">
                  <span className="win95-sunken px-3 py-2 bg-background font-black text-xs">!</span>
                  <div className="text-xs text-muted-foreground font-bold space-y-1">
                    <p>• Markets are immutable once created</p>
                    <p>• Creation fee: 0.02 SOL</p>
                    <p>• Minimum bet: 0.01 SOL, Maximum bet: 100k SOL</p>
                    <p>• Market resolves after cutoff time</p>
                  </div>
                </div>
              </div>

              <div className="win95-sunken bg-input p-3">
                <div className="text-xs font-bold space-y-1">
                  {!publicKey && (
                    <p className="text-red-600">❌ Wallet not connected - Connect your wallet to create a market</p>
                  )}
                  {publicKey && !program && (
                    <p className="text-yellow-600">⏳ Program loading... Please wait for program to initialize</p>
                  )}
                  {publicKey && program && (
                    <p className="text-green-600">✅ Ready to create market</p>
                  )}
                  {submitting && (
                    <p className="text-blue-600">🔄 Creating market...</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/")}
                  className="flex-1 font-black text-sm sm:text-base"
                  disabled={submitting}
                >
                  cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  className="flex-1 font-black text-sm sm:text-base"
                  disabled={submitting || !program || !publicKey}
                  title={
                    !publicKey
                      ? "Connect your wallet first"
                      : !program
                        ? "Program is loading, please wait"
                        : submitting
                          ? "Creating market..."
                          : "Create market"
                  }
                >
                  {submitting ? "Creating..." : "create market :)"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateMarket;
