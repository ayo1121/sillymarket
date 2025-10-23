import { NextRequest } from "next/server";
import { preflight, cors } from "@/lib/actions/cors";
import { buildClaimWinningsTx, toBase64Unsigned } from "@/lib/actions/build";
import { decodeCluster } from "@/lib/actions/connection";

type Body = {
  cluster?: string | null;
  claimer?: string;             // bettor wallet (base58)
  market?: string;              // base58
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
    const claimer = must(body.claimer, "claimer");
    const market = must(body.market, "market");
    const recentBlockhash = must(body.clientBlockhash, "clientBlockhash");

    const tx = await buildClaimWinningsTx({
      cluster,
      claimer,
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
          "Failed building claim-winnings transaction. Make sure the market is resolved and the position is claimable.",
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
