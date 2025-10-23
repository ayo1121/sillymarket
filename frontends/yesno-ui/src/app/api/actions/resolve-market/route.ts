import { NextRequest } from "next/server";
import { preflight, cors } from "@/lib/actions/cors";
import { buildResolveMarketTx, toBase64Unsigned } from "@/lib/actions/build";
import { decodeCluster } from "@/lib/actions/connection";

type Body = {
  cluster?: string | null;
  resolver?: string;            // authority wallet pubkey (base58)
  market?: string;              // base58
  outcome?: "yes" | "no";
  clientBlockhash?: string;     // latest blockhash (string)
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
    const resolver = must(body.resolver, "resolver");
    const market = must(body.market, "market");
    const outcome = (must(body.outcome, "outcome") as "yes" | "no");
    const recentBlockhash = must(body.clientBlockhash, "clientBlockhash");

    const tx = await buildResolveMarketTx({
      cluster,
      resolver,
      market,
      outcome,
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
          "Failed building resolve-market transaction. Check inputs and authority permissions.",
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
