import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAnchorProgram } from "@/solana/program";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletIdentity } from "@/auth/walletIdentity";
import { PublicKey } from "@solana/web3.js";
import {
  initialize,
  initializeConfig,
  setAuthority,
  setFeeWallet,
  resolveMarket,
  voidExpired,
  closePosition,
  createMarket,
  placeBet,
  claimWinnings,
} from "@/solana/actions";
import { fetchConfig, fetchAllMarkets, fetchMarket, fetchUserPositions, canResolveMarket, canClaimPosition } from "@/solana/read";
import { solToLamports } from "@/solana/utils";
import BN from "bn.js";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { showErrorToast } from "@/lib/errorHandling";

const solFromLamports = (lamports: number | BN): number => {
  const num = typeof lamports === "object" ? lamports.toNumber() : lamports;
  return num / 1e9;
};

const AdminPanel = () => {
  const navigate = useNavigate();
  const program = useAnchorProgram();
  const wallet = useWallet();
  const { publicKey } = wallet;
  const { username } = useWalletIdentity();
  const [config, setConfig] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [markets, setMarkets] = useState<any[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  // Initialize form states
  const [initForm, setInitForm] = useState({
    feeWallet: "",
    minBetLamports: "0.01",
    maxBetLamports: "100000",
    adminPreCutoff: false,
  });

  const [setAuthForm, setSetAuthForm] = useState({ newAuthority: "" });
  const [setFeeForm, setSetFeeForm] = useState({ newFeeWallet: "" });
  const [resolveForm, setResolveForm] = useState({
    marketAddress: "",
    winnerIndex: "0",
    platformFeeWallet: "",
    creatorWallet: "",
  });
  const [voidForm, setVoidForm] = useState({ marketAddress: "" });
  const [closePosForm, setClosePosForm] = useState({
    marketAddress: "",
    userAddress: "",
  });
  const [createMarketForm, setCreateMarketForm] = useState({
    question: "",
    answers: ["Yes", "No"],
    cutoffMinutes: "60",
    imageUrl: "",
  });
  const [placeBetForm, setPlaceBetForm] = useState({
    marketAddress: "",
    outcomeIndex: "0",
    amount: "0.1",
  });
  const [claimForm, setClaimForm] = useState({
    marketAddress: "",
    userAddress: "",
  });
  const [isCreating, setIsCreating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [resolveMarketData, setResolveMarketData] = useState<any | null>(null);
  const [claimPositionData, setClaimPositionData] = useState<any | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (!program || !publicKey) {
        setLoading(false);
        return;
      }

      try {
        // Fetch config (may not exist yet)
        try {
          const configData = await fetchConfig(program);
          const configAccount = configData.account || configData;
          setConfig(configAccount);

          // Check if user is admin
          const authority = configAccount.authority || configAccount.authority;
          if (authority) {
            const authPubkey = authority.toBase58 ? authority.toBase58() : authority.toString();
            const userIsAdmin = authPubkey === publicKey.toBase58();
            setIsAdmin(userIsAdmin);
            console.log("[AdminPanel] Admin check:", {
              authority: authPubkey,
              user: publicKey.toBase58(),
              isAdmin: userIsAdmin
            });
          }
        } catch (configErr: any) {
          console.log("[AdminPanel] Config not found or error:", configErr.message);
          // Config doesn't exist yet - that's okay, user can initialize it
          setConfig(null);
          setIsAdmin(false);
          setConfigError(null); // Clear any previous errors when checking
        }

        // Fetch all markets
        try {
          const allMarkets = await fetchAllMarkets(program);
          setMarkets(allMarkets as any[]);
        } catch (marketErr: any) {
          console.error("Error fetching markets:", marketErr);
        }
      } catch (err: any) {
        console.error("Error loading admin data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [program, publicKey]);

  const handleInitializeConfig = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    setInitializing(true);
    setConfigError(null);

    try {
      console.log("[AdminPanel] Initializing config...");
      const sig = await initializeConfig(program as any, publicKey);
      toast.success(`Config initialized! Transaction: ${sig}`);

      // Reload config after initialization
      setConfigLoading(true);
      try {
        const configData = await fetchConfig(program);
        if (configData) {
          const configAccount = configData.account || configData;
          setConfig(configAccount);
          setIsAdmin(true);
          console.log("[AdminPanel] Config loaded after initialization");
        }
      } catch (reloadErr: any) {
        console.error("[AdminPanel] Failed to reload config after init:", reloadErr);
        // Still show success since the tx went through
      } finally {
        setConfigLoading(false);
      }
    } catch (err: any) {
      console.error("[AdminPanel] Initialize config error:", err);
      showErrorToast(err, "Failed to initialize config");
      setConfigError(err?.message || "Failed to initialize config");
    } finally {
      setInitializing(false);
    }
  };

  const handleInitialize = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    try {
      const feeWalletPk = new PublicKey(initForm.feeWallet);
      const sig = await initialize(program as any, {
        authority: publicKey,
        feeWallet: feeWalletPk,
        minBetLamports: solToLamports(parseFloat(initForm.minBetLamports)),
        maxBetLamports: solToLamports(parseFloat(initForm.maxBetLamports)),
        adminPreCutoff: initForm.adminPreCutoff,
      });
      toast.success(`Config initialized! Tx: ${sig}`);
      // Reload config
      const configData = await fetchConfig(program);
      setConfig(configData.account || configData);
      setIsAdmin(true);
    } catch (err: any) {
      console.error("Initialize error:", err);
      showErrorToast(err, "Failed to initialize");
    }
  };

  const handleSetAuthority = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    try {
      const newAuthPk = new PublicKey(setAuthForm.newAuthority);
      const sig = await setAuthority(program as any, {
        authority: publicKey,
        newAuthority: newAuthPk,
      });
      toast.success(`Authority updated! Tx: ${sig}`);
      // Reload config
      const configData = await fetchConfig(program);
      setConfig(configData.account || configData);
    } catch (err: any) {
      console.error("Set authority error:", err);
      showErrorToast(err, "Failed to set authority");
    }
  };

  const handleSetFeeWallet = async () => {
    const targetFeeWallet = setFeeForm.newFeeWallet?.trim();
    console.log("[AdminPanel] Setting fee wallet:", targetFeeWallet);

    if (!targetFeeWallet) {
      console.warn("[AdminPanel] No target fee wallet set");
      return;
    }

    if (!wallet?.connected || !wallet.publicKey) {
      console.warn("[AdminPanel] Wallet not connected, cannot set fee wallet", {
        connected: wallet?.connected,
        publicKey: wallet?.publicKey?.toBase58?.(),
      });
      return;
    }

    if (!program) {
      console.warn("[AdminPanel] Program not ready, cannot set fee wallet");
      return;
    }

    const admin = wallet.publicKey.toBase58();
    const programId = program.programId.toBase58();

    console.log("[AdminPanel] Calling setFeeWallet action...", {
      newFeeWallet: targetFeeWallet,
      admin,
      programId,
    });

    try {
      await setFeeWallet({ newFeeWalletStr: targetFeeWallet, wallet });
      console.log("[AdminPanel] ✅ setFeeWallet completed");
    } catch (error) {
      console.error("[AdminPanel] ❌ Set fee wallet error:", error);
      showErrorToast(error, "Failed to set fee wallet");
    }
  };

  // Auto-fetch market data when address is entered
  useEffect(() => {
    if (!program || !resolveForm.marketAddress) {
      setResolveMarketData(null);
      return;
    }

    const loadMarket = async () => {
      try {
        const marketPk = new PublicKey(resolveForm.marketAddress);
        const marketData = await fetchMarket(program, marketPk);
        setResolveMarketData(marketData);

        // Auto-populate platform fee wallet and creator wallet
        if (marketData) {
          const platformFeeWallet = marketData.rawAccount?.platformFeeWallet || marketData.rawAccount?.platform_fee_wallet || marketData.platformFeeWallet;
          const creatorWallet = marketData.rawAccount?.creator || marketData.creatorPubkey || marketData.creator;

          if (platformFeeWallet && typeof platformFeeWallet !== "string") {
            setResolveForm(prev => ({
              ...prev,
              platformFeeWallet: platformFeeWallet.toBase58 ? platformFeeWallet.toBase58() : resolveForm.platformFeeWallet,
            }));
          } else if (platformFeeWallet) {
            setResolveForm(prev => ({
              ...prev,
              platformFeeWallet: platformFeeWallet as string,
            }));
          }

          if (creatorWallet && typeof creatorWallet !== "string") {
            setResolveForm(prev => ({
              ...prev,
              creatorWallet: creatorWallet.toBase58 ? creatorWallet.toBase58() : resolveForm.creatorWallet,
            }));
          } else if (creatorWallet) {
            setResolveForm(prev => ({
              ...prev,
              creatorWallet: creatorWallet as string,
            }));
          }
        }
      } catch (err) {
        console.error("Error loading market for resolve:", err);
        setResolveMarketData(null);
      }
    };

    loadMarket();
  }, [program, resolveForm.marketAddress]);

  // Auto-fetch position data for claim form
  useEffect(() => {
    if (!program || !claimForm.marketAddress || !claimForm.userAddress) {
      setClaimPositionData(null);
      return;
    }

    const loadPosition = async () => {
      try {
        const userPk = new PublicKey(claimForm.userAddress);
        const positions = await fetchUserPositions(program, userPk);
        const marketPk = new PublicKey(claimForm.marketAddress);
        const positionForMarket = positions.find((p: any) => {
          const posMarket = p.account.market;
          const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
          return marketPubkey === claimForm.marketAddress;
        });
        setClaimPositionData(positionForMarket || null);
      } catch (err) {
        console.error("Error loading position for claim:", err);
        setClaimPositionData(null);
      }
    };

    loadPosition();
  }, [program, claimForm.marketAddress, claimForm.userAddress]);

  const handleResolve = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    if (!resolveMarketData) {
      toast.error("Market data not loaded. Please wait or check the market address.");
      return;
    }

    // Check if user can resolve using helper
    const configAuthority = config?.authority ? (typeof config.authority === "string" ? new PublicKey(config.authority) : config.authority) : null;
    const canResolve = canResolveMarket({
      market: resolveMarketData.rawAccount || resolveMarketData,
      wallet: publicKey,
      configAuthority,
      configAdminPreCutoff: config?.adminPreCutoff ?? config?.admin_pre_cutoff ?? false,
    });

    if (!canResolve) {
      toast.error("You are not authorized to resolve this market. Only the creator (after cutoff) or config authority can resolve.");
      return;
    }

    setResolving(true);
    try {
      const marketPk = new PublicKey(resolveForm.marketAddress);
      const winnerIdx = parseInt(resolveForm.winnerIndex);

      // Get platform fee wallet and creator wallet from market account
      const platformFeeWallet = resolveMarketData.rawAccount?.platformFeeWallet || resolveMarketData.rawAccount?.platform_fee_wallet || resolveForm.platformFeeWallet;
      const creatorWallet = resolveMarketData.rawAccount?.creator || resolveMarketData.creatorPubkey || resolveForm.creatorWallet;

      if (!platformFeeWallet || !creatorWallet) {
        toast.error("Missing market data: platform fee wallet or creator wallet not found");
        setResolving(false);
        return;
      }

      const platformFeePk = typeof platformFeeWallet === "string" ? new PublicKey(platformFeeWallet) : platformFeeWallet;
      const creatorPk = typeof creatorWallet === "string" ? new PublicKey(creatorWallet) : creatorWallet;

      const sig = await resolveMarket(program as any, {
        market: marketPk,
        signer: publicKey,
        winnerIndex: winnerIdx,
        platformFeeWallet: platformFeePk,
        creatorWallet: creatorPk,
      });
      toast.success(`Market resolved! Tx: ${sig}`);

      // Reload market data
      const marketData = await fetchMarket(program, marketPk);
      setResolveMarketData(marketData);
    } catch (err: any) {
      console.error("Resolve error:", err);
      showErrorToast(err, "Failed to resolve market");
    } finally {
      setResolving(false);
    }
  };

  const handleVoidExpired = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    try {
      const marketPk = new PublicKey(voidForm.marketAddress);
      const sig = await voidExpired(program as any, { market: marketPk });
      toast.success(`Market voided! Tx: ${sig}`);
    } catch (err: any) {
      console.error("Void expired error:", err);
      showErrorToast(err, "Failed to void market");
    }
  };

  const handleClosePosition = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    try {
      const marketPk = new PublicKey(closePosForm.marketAddress);
      const userPk = new PublicKey(closePosForm.userAddress);
      const sig = await closePosition(program as any, {
        user: userPk,
        market: marketPk,
      });
      toast.success(`Position closed! Tx: ${sig}`);
    } catch (err: any) {
      console.error("Close position error:", err);
      showErrorToast(err, "Failed to close position");
    }
  };

  const handleCreateMarket = async () => {
    if (!publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    setIsCreating(true);
    try {
      const question = createMarketForm.question.trim();
      const imageUrl = createMarketForm.imageUrl || null;
      const cutoffTs = Math.floor(Date.now() / 1000) + parseInt(createMarketForm.cutoffMinutes) * 60;
      const validAnswers = createMarketForm.answers.filter(a => a.trim().length > 0);

      if (validAnswers.length < 2) {
        toast.error("Must have at least 2 answers");
        setIsCreating(false);
        return;
      }

      // Extract answers from admin form state
      const answers = validAnswers
        .map((a) => (a || "").trim())
        .filter((a) => a.length > 0)
        .slice(0, 5);

      // 1) On-chain market creation (this IS critical)
      const { txSig, marketPubkey } = await createMarket(wallet, {
        question,
        answers,
        imageUrl,
        cutoffTs,
      });

      console.log("[AdminPanel] Anchor tx success", { txSig, marketPubkey });

      // 2) Local metadata
      const creatorWallet = publicKey.toBase58();
      const createdAtIso = new Date().toISOString();

      const meta = {
        marketPubkey,
        question,
        creatorWallet,
        description: null,
        imageUrl,
        creatorName: username ?? null,
        answers,
        createdAt: createdAtIso,
      };

      const { upsertLocalMarketMetadata } = await import("../lib/marketMetadata");
      upsertLocalMarketMetadata(meta);

      // ⚠️ SECURITY NOTE: Frontend no longer writes to Supabase markets table
      // Market metadata is stored locally and read from on-chain data
      console.log("[AdminPanel] Market metadata stored locally");


      // 4) Success UI
      console.log("[AdminPanel] Created market + metadata", { txSig, marketPubkey });
      toast.success(`Market created! Tx: ${txSig}`);

      // Reset form
      setCreateMarketForm({
        question: "",
        answers: ["Yes", "No"],
        cutoffMinutes: "60",
        imageUrl: "",
      });

      // Reload markets
      if (program) {
        const allMarkets = await fetchAllMarkets(program);
        setMarkets(allMarkets as any[]);
      }
    } catch (err: any) {
      console.error("[AdminPanel] create market error", err);
      showErrorToast(err, "Failed to create market");
    } finally {
      setIsCreating(false);
    }
  };

  const handlePlaceBet = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    try {
      const marketPk = new PublicKey(placeBetForm.marketAddress);
      const sig = await placeBet(wallet, {
        marketPubkey: placeBetForm.marketAddress,
        outcomeIndex: parseInt(placeBetForm.outcomeIndex),
        stakeLamports: solToLamports(parseFloat(placeBetForm.amount)),
      });
      toast.success(`Bet placed! Tx: ${sig.txSig}`);
    } catch (err: any) {
      console.error("Place bet error:", err);
      showErrorToast(err, "Failed to place bet", "placeBet");
    }
  };

  const handleClaimWinnings = async () => {
    if (!program || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }

    if (!claimForm.marketAddress) {
      toast.error("Enter market address");
      return;
    }

    const userPk = new PublicKey(claimForm.userAddress || publicKey.toBase58());

    // Fetch market data to check claimability
    let marketData: any = null;
    try {
      const marketPk = new PublicKey(claimForm.marketAddress);
      marketData = await fetchMarket(program, marketPk, userPk);
    } catch (err) {
      console.error("Error loading market for claim:", err);
      toast.error("Failed to load market data");
      return;
    }

    if (!marketData) {
      toast.error("Market not found");
      return;
    }

    // Check if user can claim using helper
    const canClaim = canClaimPosition({
      market: marketData.rawAccount || marketData,
      position: claimPositionData?.account || claimPositionData,
      wallet: userPk,
    });

    if (!canClaim) {
      toast.error("No claimable position found. User may not have a winning position or it may already be claimed.");
      return;
    }

    setClaiming(true);
    try {
      const marketPk = new PublicKey(claimForm.marketAddress);
      const sig = await claimWinnings(program as any, {
        market: marketPk,
        user: userPk,
      });
      toast.success(`Winnings claimed! Tx: ${sig}`);

      // Reload position data
      const positions = await fetchUserPositions(program, userPk);
      const positionForMarket = positions.find((p: any) => {
        const posMarket = p.account.market;
        const marketPubkey = posMarket?.toBase58 ? posMarket.toBase58() : posMarket?.toString();
        return marketPubkey === claimForm.marketAddress;
      });
      setClaimPositionData(positionForMarket || null);
    } catch (err: any) {
      console.error("Claim winnings error:", err);
      showErrorToast(err, "Failed to claim winnings");
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-win95-teal">
        <Header />
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="win95-window bg-background p-4 text-center">
            <p>Loading admin panel...</p>
            {!program && <p className="text-xs text-muted-foreground mt-2">Waiting for program to load...</p>}
            {!publicKey && <p className="text-xs text-muted-foreground mt-2">Waiting for wallet connection...</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!program || !publicKey) {
    return (
      <div className="min-h-screen bg-win95-teal">
        <Header />
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="win95-window bg-background p-4 text-center">
            <p className="text-red-600">⚠️ Connect your wallet to access admin panel</p>
            <div className="mt-4 text-xs text-muted-foreground space-y-1">
              <p>Program loaded: {program ? "✅" : "❌"}</p>
              <p>Wallet connected: {publicKey ? "✅" : "❌"}</p>
              {publicKey && <p>Your wallet: {publicKey.toBase58()}</p>}
              {!program && (
                <div className="mt-4 p-3 bg-yellow-100 border border-yellow-500 rounded">
                  <p className="font-bold">Program not loading?</p>
                  <p className="mt-1">1. Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)</p>
                  <p>2. Check browser console for [yesno] error logs</p>
                  <p>3. Make sure wallet is fully connected</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-win95-teal">
      <Header />
      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
        <div className="win95-window bg-background p-1 mb-4">
          <div className="bg-primary text-primary-foreground px-2 sm:px-3 py-2 mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={lightbulbIcon} alt="" className="w-4 h-4 sm:w-5 sm:h-5 opacity-80" />
              <span className="font-black tracking-tight text-xs sm:text-sm">admin panel</span>
            </div>
          </div>
          <div className="win95-sunken bg-background p-4 sm:p-8">
            {/* Config Info */}
            {config ? (
              <div className="mb-6 win95-sunken bg-input p-4">
                <h3 className="font-black text-sm mb-2">Current Config</h3>
                <div className="text-xs space-y-1 font-bold">
                  <p>Authority: {config.authority?.toBase58() || config.authority || "N/A"}</p>
                  <p>Fee Wallet: {(() => {
                    const defaultPubkey = "11111111111111111111111111111111";
                    const feeWallet = config.fee_wallet || config.feeWallet;
                    const feeWalletStr = feeWallet?.toBase58 ? feeWallet.toBase58() : (typeof feeWallet === "string" ? feeWallet : null);
                    return feeWalletStr && feeWalletStr !== defaultPubkey ? feeWalletStr : "n/a";
                  })()}</p>
                  <p>Min Bet: {solFromLamports(config.min_bet_lamports?.toNumber() || config.minBetLamports || 0)} SOL</p>
                  <p>Max Bet: {solFromLamports(config.max_bet_lamports?.toNumber() || config.maxBetLamports || 0)} SOL</p>
                  <p className={isAdmin ? "text-green-600" : "text-red-600"}>
                    Admin Status: {isAdmin ? "✅ You are the admin" : "❌ You are NOT the admin"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mb-6 win95-sunken bg-yellow-100 p-4 border-2 border-yellow-500">
                <h3 className="font-black text-sm mb-2">⚠️ Config account not initialized on this cluster.</h3>
                <p className="text-xs mb-3">The program requires a config account to be initialized before creating markets.</p>
                {publicKey && program && (
                  <div className="space-y-2">
                    <Button
                      onClick={handleInitializeConfig}
                      disabled={initializing || configLoading}
                      className="w-full text-xs"
                      size="sm"
                    >
                      {initializing ? "Initializing..." : configLoading ? "Loading..." : "Initialize Config"}
                    </Button>
                    {configError && (
                      <p className="text-xs text-red-600 font-bold mt-2">
                        Error: {configError}
                      </p>
                    )}
                    {initializing && (
                      <p className="text-xs text-blue-600 font-bold mt-2">
                        ⏳ Transaction in progress... Please wait.
                      </p>
                    )}
                  </div>
                )}
                {(!publicKey || !program) && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Connect your wallet to initialize the config.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Initialize Config */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">1. Initialize Config</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Fee Wallet (Pubkey)</Label>
                    <Input
                      value={initForm.feeWallet}
                      onChange={(e) => setInitForm({ ...initForm, feeWallet: e.target.value })}
                      placeholder="Fee wallet address"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Min Bet (SOL)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={initForm.minBetLamports}
                      onChange={(e) => setInitForm({ ...initForm, minBetLamports: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Max Bet (SOL)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={initForm.maxBetLamports}
                      onChange={(e) => setInitForm({ ...initForm, maxBetLamports: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={initForm.adminPreCutoff}
                      onChange={(e) => setInitForm({ ...initForm, adminPreCutoff: e.target.checked })}
                    />
                    <Label className="text-xs">Admin Pre-Cutoff</Label>
                  </div>
                  <Button onClick={handleInitialize} className="w-full text-xs" size="sm">
                    Initialize
                  </Button>
                </div>
              </div>

              {/* Set Authority */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">2. Set Authority</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">New Authority (Pubkey)</Label>
                    <Input
                      value={setAuthForm.newAuthority}
                      onChange={(e) => setSetAuthForm({ newAuthority: e.target.value })}
                      placeholder="New authority address"
                      className="text-xs"
                    />
                  </div>
                  <Button onClick={handleSetAuthority} className="w-full text-xs" size="sm" disabled={!isAdmin}>
                    Set Authority
                  </Button>
                </div>
              </div>

              {/* Set Fee Wallet */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">3. Set Fee Wallet</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">New Fee Wallet (Pubkey)</Label>
                    <Input
                      value={setFeeForm.newFeeWallet}
                      onChange={(e) => setSetFeeForm({ newFeeWallet: e.target.value })}
                      placeholder="New fee wallet address"
                      className="text-xs"
                    />
                  </div>
                  <Button onClick={handleSetFeeWallet} className="w-full text-xs" size="sm" disabled={!isAdmin}>
                    Set Fee Wallet
                  </Button>
                </div>
              </div>

              {/* Resolve Market */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">4. Resolve Market</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Market Address</Label>
                    <Input
                      value={resolveForm.marketAddress}
                      onChange={(e) => setResolveForm({ ...resolveForm, marketAddress: e.target.value })}
                      placeholder="Market PDA"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Winner Index (-2=VOID, -1=UNSET, 0+=winner)</Label>
                    <Input
                      type="number"
                      value={resolveForm.winnerIndex}
                      onChange={(e) => setResolveForm({ ...resolveForm, winnerIndex: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Platform Fee Wallet</Label>
                    <Input
                      value={resolveForm.platformFeeWallet}
                      onChange={(e) => setResolveForm({ ...resolveForm, platformFeeWallet: e.target.value })}
                      placeholder="Platform fee wallet"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Creator Wallet</Label>
                    <Input
                      value={resolveForm.creatorWallet}
                      onChange={(e) => setResolveForm({ ...resolveForm, creatorWallet: e.target.value })}
                      placeholder="Creator wallet"
                      className="text-xs"
                    />
                  </div>
                  {resolveMarketData && publicKey && config && (() => {
                    const configAuthority = config.authority ? (typeof config.authority === "string" ? new PublicKey(config.authority) : config.authority) : null;
                    const canResolve = canResolveMarket({
                      market: resolveMarketData.rawAccount || resolveMarketData,
                      wallet: publicKey,
                      configAuthority,
                      configAdminPreCutoff: config.adminPreCutoff ?? config.admin_pre_cutoff ?? false,
                    });
                    return (
                      <div className="text-xs text-muted-foreground mb-2">
                        {canResolve ? "✅ You can resolve this market" : "❌ You cannot resolve this market"}
                      </div>
                    );
                  })()}
                  <Button
                    onClick={handleResolve}
                    className="w-full text-xs"
                    size="sm"
                    disabled={!isAdmin || resolving || !resolveMarketData || (() => {
                      if (!publicKey || !config || !resolveMarketData) return true;
                      const configAuthority = config.authority ? (typeof config.authority === "string" ? new PublicKey(config.authority) : config.authority) : null;
                      return !canResolveMarket({
                        market: resolveMarketData.rawAccount || resolveMarketData,
                        wallet: publicKey,
                        configAuthority,
                        configAdminPreCutoff: config.adminPreCutoff ?? config.admin_pre_cutoff ?? false,
                      });
                    })()}
                  >
                    {resolving ? "Resolving..." : "Resolve Market"}
                  </Button>
                </div>
              </div>

              {/* Void Expired */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">5. Void Expired Market</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Market Address</Label>
                    <Input
                      value={voidForm.marketAddress}
                      onChange={(e) => setVoidForm({ marketAddress: e.target.value })}
                      placeholder="Market PDA"
                      className="text-xs"
                    />
                  </div>
                  <Button onClick={handleVoidExpired} className="w-full text-xs" size="sm">
                    Void Expired
                  </Button>
                </div>
              </div>

              {/* Close Position */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">6. Close Position</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Market Address</Label>
                    <Input
                      value={closePosForm.marketAddress}
                      onChange={(e) => setClosePosForm({ ...closePosForm, marketAddress: e.target.value })}
                      placeholder="Market PDA"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">User Address</Label>
                    <Input
                      value={closePosForm.userAddress}
                      onChange={(e) => setClosePosForm({ ...closePosForm, userAddress: e.target.value })}
                      placeholder="User pubkey"
                      className="text-xs"
                    />
                  </div>
                  <Button onClick={handleClosePosition} className="w-full text-xs" size="sm">
                    Close Position
                  </Button>
                </div>
              </div>

              {/* Create Market */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">7. Create Market</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Question</Label>
                    <Textarea
                      value={createMarketForm.question}
                      onChange={(e) => setCreateMarketForm({ ...createMarketForm, question: e.target.value })}
                      placeholder="Market question"
                      className="text-xs"
                      rows={2}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Answers (comma-separated)</Label>
                    <Input
                      value={createMarketForm.answers.join(", ")}
                      onChange={(e) => setCreateMarketForm({ ...createMarketForm, answers: e.target.value.split(",").map(a => a.trim()) })}
                      placeholder="Yes, No"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Cutoff (minutes)</Label>
                    <Input
                      type="number"
                      value={createMarketForm.cutoffMinutes}
                      onChange={(e) => setCreateMarketForm({ ...createMarketForm, cutoffMinutes: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Image URL (optional)</Label>
                    <Input
                      value={createMarketForm.imageUrl}
                      onChange={(e) => setCreateMarketForm({ ...createMarketForm, imageUrl: e.target.value })}
                      placeholder="Image URL"
                      className="text-xs"
                    />
                  </div>
                  <Button
                    onClick={handleCreateMarket}
                    className="w-full text-xs"
                    size="sm"
                    disabled={isCreating}
                  >
                    {isCreating ? "Creating..." : "Create Market"}
                  </Button>
                </div>
              </div>

              {/* Place Bet */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">8. Place Bet</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Market Address</Label>
                    <Input
                      value={placeBetForm.marketAddress}
                      onChange={(e) => setPlaceBetForm({ ...placeBetForm, marketAddress: e.target.value })}
                      placeholder="Market PDA"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Outcome Index</Label>
                    <Input
                      type="number"
                      value={placeBetForm.outcomeIndex}
                      onChange={(e) => setPlaceBetForm({ ...placeBetForm, outcomeIndex: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Amount (SOL)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={placeBetForm.amount}
                      onChange={(e) => setPlaceBetForm({ ...placeBetForm, amount: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                  <Button onClick={handlePlaceBet} className="w-full text-xs" size="sm">
                    Place Bet
                  </Button>
                </div>
              </div>

              {/* Claim Winnings */}
              <div className="win95-raised bg-background p-4 border-2 border-black">
                <h3 className="font-black text-sm mb-3">9. Claim Winnings</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Market Address</Label>
                    <Input
                      value={claimForm.marketAddress}
                      onChange={(e) => setClaimForm({ ...claimForm, marketAddress: e.target.value })}
                      placeholder="Market PDA"
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">User Address (leave empty for current wallet)</Label>
                    <Input
                      value={claimForm.userAddress}
                      onChange={(e) => setClaimForm({ ...claimForm, userAddress: e.target.value })}
                      placeholder={publicKey.toBase58()}
                      className="text-xs"
                    />
                  </div>
                  {claimPositionData && (
                    <div className="text-xs text-muted-foreground mb-2">
                      Position found. Claim will be validated on submit.
                    </div>
                  )}
                  <Button
                    onClick={handleClaimWinnings}
                    className="w-full text-xs"
                    size="sm"
                    disabled={claiming || !claimForm.marketAddress || !claimForm.userAddress || !claimPositionData}
                  >
                    {claiming ? "Claiming..." : "Claim Winnings"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Markets List */}
            <div className="mt-6 win95-raised bg-background p-4 border-2 border-black">
              <h3 className="font-black text-sm mb-3">All Markets ({markets.length})</h3>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {markets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No markets found</p>
                ) : (
                  markets.map((m: any) => {
                    const market = m.account || m;
                    const marketPk = m.publicKey?.toBase58() || m.publicKey;
                    return (
                      <div
                        key={marketPk}
                        className="win95-sunken bg-input p-2 text-xs cursor-pointer hover:opacity-80"
                        onClick={() => navigate(`/market/${marketPk}`)}
                      >
                        <div className="font-bold truncate">{market.displayQuestion || "No question"}</div>
                        <div className="text-muted-foreground truncate">{marketPk}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
