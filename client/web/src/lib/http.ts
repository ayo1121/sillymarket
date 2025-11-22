export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

export async function api(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      ...init
    } as RequestInit);
    
    // Special handling for /me - treat non-200 as guest, not error
    if (path === "/me" && !res.ok) {
      console.warn("[yesno] /me returned non-200, treating as guest", res.status);
      return { ok: true, user: null };
    }
    
    // Handle network errors for other endpoints
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, data });
    }
    
    const data = await res.json().catch(() => ({}));
    return data;
  } catch (error: any) {
    // Special handling for /me - treat network errors as guest
    if (path === "/me") {
      console.warn("[yesno] /me request failed, treating as guest", error.message);
      return { ok: true, user: null };
    }
    
    // Handle fetch errors (network failures, CORS, etc.)
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      throw Object.assign(
        new Error("Cannot connect to server. Make sure the backend is running on port 8787."),
        { status: 0, isNetworkError: true }
      );
    }
    throw error;
  }
}

