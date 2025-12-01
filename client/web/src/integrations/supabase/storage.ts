import { supabase } from "./client";

const MARKET_IMAGES_BUCKET = "market-images";

/**
 * Upload a market image to Supabase Storage and return its public URL.
 * The path is kept short so the final URL stays well under 200 chars.
 */
export async function uploadMarketImage(file: File): Promise<string> {
  // Check if Supabase env vars are configured
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey || supabaseKey === "REPLACE_WITH_SUPABASE_ANON_KEY") {
    const errorMsg = "Supabase env vars VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not configured. Please set them in .env.local";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Basic size guard (frontend already checks, but keep here too)
  const maxBytes = 5 * 1024 * 1024; // 5 MB
  if (file.size > maxBytes) {
    throw new Error("Image must be less than 5MB");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const random = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  const path = `mkt/${ts}-${random}.${ext}`;

  try {
    const { data, error } = await supabase.storage
      .from(MARKET_IMAGES_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error || !data) {
      const errorMsg = error?.message || "Failed to upload image to Supabase Storage";
      console.error("[Supabase] uploadMarketImage error:", {
        message: error?.message,
        code: (error as any)?.code,
        path
      });
      throw new Error(errorMsg);
    }

    const { data: publicData } = supabase.storage
      .from(MARKET_IMAGES_BUCKET)
      .getPublicUrl(data.path);

    const url = publicData?.publicUrl ?? "";
    if (!url) {
      throw new Error("Failed to get image URL from Supabase Storage");
    }
    if (url.length > 200) {
      // Matches on-chain constraint in createMarket
      throw new Error("Image URL is too long (> 200 chars)");
    }

    return url;
  } catch (error: any) {
    // Re-throw with more context if it's not already a helpful error
    if (error?.message && !error.message.includes("Supabase")) {
      console.error("Supabase Storage upload failed:", error);
      throw new Error(`Image upload failed: ${error.message}`);
    }
    throw error;
  }
}

