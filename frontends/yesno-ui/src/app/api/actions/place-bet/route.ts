import { NextRequest } from "next/server";
import { preflight, cors } from "@/lib/actions/cors";
import { buildPlaceBetTx, toBase64Unsigned } from "@/lib/actions/build";
import { decodeCluster } from "@/lib/actions/connection";

type Body = {
  cluster?: string | null;
  payer?: string;                 // base58
  market?: string;                // base58
  side?: "yes" | "no";
  amountBaseUnits?: string;       // e.g. "1000000" for 1.0 with 6 decimals
  clientBlockhash?: string;       // latest blockhash (string)
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
    const payer = must(body.payer, "payer");
    const market = must(body.market, "market");
    const side = (must(body.side, "side") as "yes" | "no");
    const amountBaseUnits = must(body.amountBaseUnits, "amountBaseUnits");
    const recentBlockhash = must(body.clientBlockhash, "clientBlockhash");

    const tx = await buildPlaceBetTx({
      cluster,
      payer,
      market,
      side,
      amountBaseUnits,
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
          "Failed building place-bet transaction. Ensure you fetched a fresh blockhash and provided valid pubkeys.",
      },
      400
    );
  }
}

function must<T>(v: T | null | undefined, name: string): T {
  const s = (v as any)?.toString?.().trim?.() ?? "";
  if (!s) throw new Error(`missing field "${name}"`);
  return v as T;
}
