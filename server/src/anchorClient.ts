
import { Program, AnchorProvider, Wallet, Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load IDL
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Adjust path as needed based on where this file is: server/src/anchorClient.ts -> server/src/idl/yesno_markets.json
const IDL_PATH = path.join(__dirname, "idl", "yesno_markets.json");

let idl: Idl;
try {
    const idlContent = fs.readFileSync(IDL_PATH, "utf-8");
    idl = JSON.parse(idlContent);
} catch (e) {
    console.warn("⚠️ Could not load IDL from", IDL_PATH, e);
}

// Config
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || process.env.WALLET_PATH;

let program: Program | null = null;
let provider: AnchorProvider | null = null;

export function getAnchorProgram() {
    if (program) return { program, provider };

    if (!idl) {
        throw new Error("IDL not loaded");
    }

    // Setup connection
    const connection = new Connection(RPC_URL, "confirmed");

    // Setup wallet
    let wallet: Wallet;

    if (WALLET_PATH && fs.existsSync(WALLET_PATH)) {
        try {
            const keypairData = JSON.parse(fs.readFileSync(WALLET_PATH, "utf-8"));
            const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
            wallet = new Wallet(keypair);
        } catch (e) {
            console.error("Failed to load wallet from path:", WALLET_PATH, e);
            throw new Error("Failed to load wallet");
        }
    } else if (process.env.WALLET_PRIVATE_KEY) {
        // Support raw private key from env
        try {
            const keypair = Keypair.fromSecretKey(bs58Decode(process.env.WALLET_PRIVATE_KEY));
            wallet = new Wallet(keypair);
        } catch (e) {
            throw new Error("Failed to parse WALLET_PRIVATE_KEY");
        }
    } else {
        // Fallback/Dummy wallet for read-only if needed, but we need signing.
        console.warn("⚠️ No wallet found (ANCHOR_WALLET not set). On-chain transactions will fail.");
        // Generate a random one just to init provider (will fail signing)
        wallet = new Wallet(Keypair.generate());
    }

    provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });

    program = new Program(idl, provider);
    return { program, provider };
}

// Simple bs58 decode helper to avoid adding bs58 dep if not needed, 
// but we verified bs58 is in package.json dependencies.
import bs58 from "bs58";
function bs58Decode(str: string): Uint8Array {
    return bs58.decode(str);
}
