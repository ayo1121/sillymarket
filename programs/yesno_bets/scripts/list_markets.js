const fs=require('fs');
const anchor=require('@coral-xyz/anchor');
const {Connection,PublicKey}=anchor.web3;

(async()=>{
  const conn=new Connection('https://api.devnet.solana.com','confirmed');
  const programId=new PublicKey(process.env.PROG_ID);
  const idl=JSON.parse(fs.readFileSync('target/idl/yesno_bets.json','utf8'));
  const coder=new anchor.BorshCoder(idl);
  const mName=(idl.accounts||[]).find(a=>/market/i.test(a.name))?.name;
  if(!mName) throw new Error('Market account not found in IDL');
  const accs=await conn.getProgramAccounts(programId);
  for(const a of accs){
    try{
      const m=coder.accounts.decode(mName,a.account.data);
      console.log({
        pubkey:a.pubkey.toBase58(),
        creator:m.creator?.toBase58?.()||m.creator,
        mint:m.betMint?.toBase58?.()||m.bet_mint,
        cutoff:m.cutoffTs?.toNumber?.()||m.cutoff_ts,
        resolved:m.resolved,
        win:m.winningOutcome||m.winning_outcome,
        yes:m.totalYes?.toString?.()||m.total_yes?.toString?.(),
        no:m.totalNo?.toString?.()||m.total_no?.toString?.(),
        fees:m.feesAccrued?.toString?.()||m.fees_accrued?.toString?.(),
      });
    }catch{}
  }
})();
