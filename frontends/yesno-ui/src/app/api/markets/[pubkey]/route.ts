import { NextRequest } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { preflight, cors } from "@/lib/actions/cors";
import { decodeCluster, resolveRpcUrl } from "@/lib/actions/connection";

export async function OPTIONS(req: NextRequest) {
  const pf = preflight(req);
  return pf ?? cors({ ok: true }, 200, req);
}

/**
 * GET /api/markets/[pubkey]?cluster=devnet
 * Returns basic account info for a specific pubkey.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: { pubkey: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const cluster = decodeCluster(searchParams.get("cluster"));
    const rpcUrl = resolveRpcUrl(cluster);

    const pk = new PublicKey(ctx.params.pubkey);
    const connection = new Connection(rpcUrl, { commitment: "confirmed" });
    const info = await connection.getAccountInfo(pk, { commitment: "confirmed" });

    if (!info) {
      return cors({ error: "Not found", pubkey: pk.toBase58() }, 404, req);
    }

    return cors(
      {
        cluster,
        rpcUrl,
        pubkey: pk.toBase58(),
        lamports: info.lamports,
        owner: info.owner.toBase58(),
        executable: info.executable,
        dataLen: info.data.length,
      },
      200,
      req
    );
  } catch (e: any) {
    return cors({ error: e?.message ?? String(e) }, 500, req);
  }
}
