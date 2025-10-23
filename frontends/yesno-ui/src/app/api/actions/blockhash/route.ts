import { NextRequest } from "next/server";
import { Connection } from "@solana/web3.js";
import { decodeCluster, resolveRpcUrl } from "@/lib/actions/connection";
import { preflight, cors } from "@/lib/actions/cors";

export async function OPTIONS(req: NextRequest) {
  const pf = preflight(req);
  return pf ?? cors({ ok: true }, 200);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clusterParam = searchParams.get("cluster");
    const cluster = decodeCluster(clusterParam);
    const rpcUrl = resolveRpcUrl(cluster);

    const connection = new Connection(rpcUrl, { commitment: "confirmed" });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");

    return cors(
      {
        cluster,
        rpcUrl,
        blockhash,
        lastValidBlockHeight,
      },
      200
    );
  } catch (e: any) {
    return cors({ error: e?.message ?? "failed to fetch blockhash" }, 500);
  }
}

export async function POST(req: NextRequest) {
  // Allow POST as an alias to GET (some clients prefer POST)
  return GET(req);
}
