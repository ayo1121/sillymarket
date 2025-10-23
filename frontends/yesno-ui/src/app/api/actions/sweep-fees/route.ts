import { NextRequest } from "next/server";
import { preflight, cors } from "@/lib/actions/cors";
import { buildSweepFeesTx, toBase64Unsigned } from "@/lib/actions/build";
import { decodeCluster } from "@/lib/actions/connection";

type Body = {
  cluster?: string | null;
  authority?: string;              // owner/authority wallet (base58)
  market?: string | null;          // optional market (base58) if sweeping per-market
  clientBlockhash?: string;        // latest blockhash (string)
  priorityFeeMicroLamports?: number;
};

export async function OPTIONS(req: NextRequest) {
  const pf = preflight(req);
  return pf ?? cors({ ok: true }, 200);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    const cluster = decodeCluster(body.cluster);
    const authority = must(body.authority, "authority");
    const recentBlockhash = must(body.clientBlockhash, "clientBlockhash");

    // market is optional — only include if provided and non-empty
    const market = optional(body.market);

    const tx = await buildSweepFeesTx({
      cluster,
      authority,
      market,
      recentBlockhash,
      priorityFeeMicroLamports: body.priorityFeeMicroLamports,
    });

    const base64 = toBase64Unsigned(tx);

    return cors(
      {
        cluster,
        unsignedTx: base64,
      },
      200
    );
  } catch (e: any) {
    return cors(
      {
        error:
          e?.message ??
          "Failed building sweep-fees transaction. Check authority permissions and (if required) provide a valid market.",
      },
      400
    );
  }
}

/* --------------------------------- utils --------------------------------- */
function must<T>(v: T | null | undefined, name: string): T {
  const s = (v as any)?.toString?.().trim?.() ?? "";
  if (!s) throw new Error(`missing field "${name}"`);
  return v as T;
}
function optional<T>(v: T | null | undefined): T | undefined {
  const s = (v as any)?.toString?.().trim?.() ?? "";
  return s ? (v as T) : undefined;
}
