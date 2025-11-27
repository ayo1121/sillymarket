import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Upload, X, Plus, Trash2, ArrowLeft } from "lucide-react";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { toast } from "sonner";
import { useAnchorProgram } from "@/solana/program";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { createMarket } from "@/solana/actions";
import { PublicKey } from "@solana/web3.js";
import { uploadMarketImage } from "@/integrations/supabase/storage";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { showErrorToast } from "@/lib/errorHandling";
import { logPageView } from "@/lib/analytics";

const CreateMarket = () => {
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const anchorWallet = useAnchorWallet();
  const { username } = useWalletIdentity();

  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState<string[]>(["Yes", "No"]);
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [durationType, setDurationType] = useState<"preset" | "custom">("preset");
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

  // Track page view
  useEffect(() => {
    logPageView('create_market');
  }, []);

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

    // Validate lengths
    if (question.trim().length > 140) {
      toast.error("Question must be 140 characters or less");
      return;
    }

    // Validate time input (must be at least 5 minutes, max 48 hours = 2880 minutes)
    if (durationMinutes < 5) {
      toast.error("Market must end at least 5 minutes from now");
      return;
    }
    if (durationMinutes > 48 * 60) {
      toast.error("Market must end within 48 hours (2880 minutes) from now");
      return;
    }

    // Calculate cutoff timestamp
    const now = Math.floor(Date.now() / 1000);
    const cutoffTs = now + (durationMinutes * 60);

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

      // 1) On-chain market creation (this IS critical)
      const { txSig, marketPubkey } = await createMarket(wallet, {
        cutoffTs: cutoffTs,
        question: question.trim(),
        answers: answers,
        imageUrl: finalImageUrl || null,
      });

      console.log("[CreateMarket] Anchor tx success", { txSig, marketPubkey });

      // 2) Store metadata in Supabase for global access
      const creatorWallet = wallet.publicKey?.toBase58() ?? null;
      const createdAtIso = new Date().toISOString();

      const metadata = {
        marketPubkey,
        question: question.trim(),
        creatorWallet,
        description: description.trim() || null,
        imageUrl: finalImageUrl || null,
        creatorName: username ?? null,
        answers: answers,
        createdAt: createdAtIso,
      };

      // Save market metadata via backend API
      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const response = await fetch(`${API_URL}/markets/metadata`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // Include cookies for SIWS session
          body: JSON.stringify({
            marketPubkey,
            question: question.trim(),
            creatorWallet,
            creatorName: username || undefined,
            imageUrl: finalImageUrl || undefined,
            answers,
            description: description.trim() || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('[CreateMarket] Backend API failed:', errorData);
          toast.error('Market created but metadata save failed. Some info may not display.');
        } else {
          console.log('[CreateMarket] Market metadata stored via backend');
        }
      } catch (apiErr) {
        console.error('[CreateMarket] Backend API exception:', apiErr);
        toast.error('Market created but metadata save failed. Some info may not display.');
      }

      // Also store locally as fallback
      const { upsertLocalMarketMetadata } = await import("../lib/marketMetadata");
      upsertLocalMarketMetadata(metadata);

      console.log("[CreateMarket] Market metadata stored");

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
      showErrorToast(error, "Failed to create market");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-8">
        {/* Top Navigation Bar - Retro Toolbar Style */}
        <div className="bg-[#d4d0c8] dark:bg-[#242424] border border-[#8b8b8b] dark:border-[#3a3a3a] rounded-sm shadow-[inset_1px_1px_0_rgba(255,255,255,0.8),inset_-1px_-1px_0_rgba(0,0,0,0.2)] px-3 py-2">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="font-semibold text-sm hover:bg-[#e8e8e8] dark:hover:bg-[#323232] px-3 py-2 h-auto"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Markets
          </Button>
        </div>

        {/* Create Market Form Card */}
        <div className="bg-white dark:bg-[#1f1f1f] border-2 border-[#8b8b8b] dark:border-[#3a3a3a] rounded shadow-[2px_2px_0_rgba(0,0,0,0.2)] p-8 relative overflow-hidden">
          {/* Faint smiley watermark */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] text-[250px] font-black text-gray-400 select-none">
            : )
          </div>

          <div className="relative z-10">
            <h1 className="text-3xl font-black uppercase tracking-tighter mb-8 text-[#111] dark:text-white border-b-4 border-[#15a349] pb-2 inline-block">
              Create New Market
            </h1>

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Question Input */}
              <div className="space-y-3">
                <label className="block text-sm font-black uppercase tracking-wide text-[#555] dark:text-[#c7c7c7]">
                  Market Question
                </label>
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. Will Bitcoin hit $100k in 2024?"
                  className="min-h-[100px] text-lg font-bold bg-[#fafafa] dark:bg-[#1a1a1a] border-2 border-[#d3d3d3] dark:border-[#333] focus:border-[#111] dark:focus:border-white rounded resize-none p-4 shadow-inner"
                  maxLength={140}
                />
                <p className="text-xs text-right text-[#999] font-mono">
                  {question.length}/140
                </p>
              </div>

              {/* Description Input */}
              <div className="space-y-3">
                <label className="block text-sm font-black uppercase tracking-wide text-[#555] dark:text-[#c7c7c7]">
                  Description (Optional)
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add more details about resolution criteria, sources, etc."
                  className="min-h-[100px] text-sm font-medium bg-[#fafafa] dark:bg-[#1a1a1a] border-2 border-[#d3d3d3] dark:border-[#333] focus:border-[#111] dark:focus:border-white rounded resize-none p-4 shadow-inner"
                  maxLength={1000}
                />
                <p className="text-xs text-right text-[#999] font-mono">
                  {description.length}/1000
                </p>
              </div>

              {/* Image Upload or URL */}
              <div className="space-y-3">
                <label className="block text-sm font-black uppercase tracking-wide text-[#555] dark:text-[#c7c7c7]">
                  Market Image (Optional)
                </label>

                <div className="flex flex-col gap-4">
                  {/* Upload Tab / URL Tab Toggle could go here, but for now let's offer both or just the upload which populates the URL */}

                  {!imagePreview ? (
                    <div className="border-2 border-dashed border-[#d3d3d3] dark:border-[#333] rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-[#fafafa] dark:hover:bg-[#1a1a1a] transition-colors cursor-pointer relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <Upload className="w-8 h-8 text-[#999] mb-2" />
                      <p className="text-sm font-bold text-[#555] dark:text-[#c7c7c7]">Click to upload image</p>
                      <p className="text-xs text-[#999] mt-1">or drag and drop (max 5MB)</p>

                      <div className="w-full flex items-center gap-2 mt-4">
                        <div className="h-[1px] bg-[#e0e0e0] dark:bg-[#333] flex-1"></div>
                        <span className="text-[10px] font-bold text-[#999] uppercase">OR</span>
                        <div className="h-[1px] bg-[#e0e0e0] dark:bg-[#333] flex-1"></div>
                      </div>

                      <div className="w-full mt-3 relative z-10">
                        <Input
                          value={imageUrl}
                          onChange={(e) => setImageUrl(e.target.value)}
                          placeholder="Paste image URL directly..."
                          className="h-10 bg-white dark:bg-[#2a2a2a] text-sm"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="relative w-full sm:w-64 h-48 bg-[#f0f0f0] dark:bg-[#1a1a1a] rounded-lg border-2 border-[#d3d3d3] dark:border-[#333] overflow-hidden group">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Answers Input */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-black uppercase tracking-wide text-[#555] dark:text-[#c7c7c7]">
                    Outcomes (2-5)
                  </label>
                  <span className="text-xs text-[#999] font-bold">{answers.length}/5</span>
                </div>

                <div className="space-y-3">
                  {answers.map((answer, index) => (
                    <div key={index} className="flex gap-2">
                      <div className="flex-1 relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#999]">
                          #{index + 1}
                        </div>
                        <Input
                          value={answer}
                          onChange={(e) => {
                            const newAnswers = [...answers];
                            newAnswers[index] = e.target.value;
                            setAnswers(newAnswers);
                          }}
                          placeholder={`Outcome ${index + 1}`}
                          className="pl-8 h-11 font-bold bg-[#fafafa] dark:bg-[#1a1a1a] border-2 border-[#d3d3d3] dark:border-[#333] focus:border-[#111] dark:focus:border-white rounded shadow-sm"
                          maxLength={64}
                        />
                      </div>
                      {answers.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (answers.length > 2) {
                              setAnswers(answers.filter((_, i) => i !== index));
                            }
                          }}
                          className="h-11 w-11 text-[#999] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded border-2 border-transparent hover:border-red-200 dark:hover:border-red-900/30"
                        >
                          <Trash2 className="w-5 h-5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {answers.length < 5 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAnswers([...answers, ""])}
                    className="w-full h-11 border-2 border-dashed border-[#d3d3d3] dark:border-[#333] text-[#999] hover:text-[#111] dark:hover:text-white hover:border-[#999] dark:hover:border-[#666] font-bold gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Outcome
                  </Button>
                )}
              </div>

              {/* Duration Selection */}
              <div className="space-y-4">
                <label className="block text-sm font-black uppercase tracking-wide text-[#555] dark:text-[#c7c7c7]">
                  Market Duration
                </label>

                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "1 Hour", value: 60 },
                    { label: "12 Hours", value: 720 },
                    { label: "24 Hours", value: 1440 },
                    { label: "48 Hours", value: 2880 },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setDurationType("preset");
                        setDurationMinutes(option.value);
                      }}
                      className={`p-3 rounded border-2 font-bold text-sm transition-all ${durationType === "preset" && durationMinutes === option.value
                        ? "bg-[#111] text-white border-[#111] dark:bg-white dark:text-black dark:border-white shadow-md transform -translate-y-0.5"
                        : "bg-white dark:bg-[#2a2a2a] text-[#555] dark:text-[#c7c7c7] border-[#d3d3d3] dark:border-[#444] hover:border-[#999] dark:hover:border-[#666]"
                        }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[#e0e0e0] dark:border-[#333]"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white dark:bg-[#1f1f1f] px-2 text-[#999]">Or Custom Duration</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-[#fafafa] dark:bg-[#1a1a1a] p-4 rounded border border-[#e0e0e0] dark:border-[#333]">
                  <div className="flex-1">
                    <label className="block text-xs font-bold uppercase text-[#999] mb-1.5">
                      Duration (Minutes)
                    </label>
                    <Input
                      type="number"
                      min="5"
                      max="2880"
                      value={durationMinutes}
                      onChange={(e) => {
                        setDurationType("custom");
                        let val = parseInt(e.target.value) || 0;
                        if (val > 2880) val = 2880;
                        setDurationMinutes(val);
                      }}
                      className={`h-11 font-mono font-bold text-lg ${durationType === "custom"
                        ? "border-[#111] dark:border-white bg-white dark:bg-[#2a2a2a]"
                        : "border-[#d3d3d3] dark:border-[#333] bg-transparent text-[#999]"
                        }`}
                    />
                  </div>
                  <div className="flex flex-col justify-end pb-2">
                    <div className="text-xs font-bold text-[#555] dark:text-[#c7c7c7]">
                      Ends: {new Date(Date.now() + durationMinutes * 60000).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-6 border-t-2 border-[#f0f0f0] dark:border-[#333]">
                <Button
                  type="submit"
                  disabled={submitting || !question.trim() || durationMinutes < 5}
                  className="w-full h-14 text-lg font-black uppercase tracking-wider shadow-[4px_4px_0_#000] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] active:translate-y-[4px] active:shadow-none transition-all border-2 border-black dark:border-white bg-[#15a349] hover:bg-[#128a3e] text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">⏳</span> Creating Market...
                    </span>
                  ) : (
                    "🚀 Launch Market"
                  )}
                </Button>
                <p className="text-center text-xs text-[#999] mt-4">
                  By creating a market, you agree to the platform rules. Markets cannot be edited once created.
                </p>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreateMarket;
