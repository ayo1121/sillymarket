// Test context setup and utilities for adversarial tests

use anchor_lang::prelude::*;
use solana_program_test::*;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    pubkey::Pubkey,
    system_instruction,
    clock::Clock,
};
use std::rc::Rc;

pub struct TestContext {
    pub banks_client: BanksClient,
    pub payer: Keypair,
    pub recent_blockhash: solana_sdk::hash::Hash,
    pub program_id: Pubkey,
}

impl TestContext {
    pub async fn get_clock(&mut self) -> Clock {
        self.banks_client.get_sysvar::<Clock>().await.unwrap()
    }
    
    pub async fn warp_to_timestamp(&mut self, timestamp: i64) {
        // Note: This is a simplified version
        // In real tests, you'd use warp_to_slot or similar
        // For now, this is a placeholder
    }
    
    pub async fun fund_account(&mut self, pubkey: &Pubkey, lamports: u64) {
        let ix = system_instruction::transfer(
            &self.payer.pubkey(),
            pubkey,
            lamports,
        );
        
        let mut transaction = Transaction::new_with_payer(
            &[ix],
            Some(&self.payer.pubkey()),
        );
        transaction.sign(&[&self.payer], self.recent_blockhash);
        
        self.banks_client
            .process_transaction(transaction)
            .await
            .unwrap();
    }
}

pub async fn setup_test_context() -> TestContext {
    let program_id = Pubkey::new_unique();
    let mut program_test = ProgramTest::new(
        "yesno_markets",
        program_id,
        processor!(yesno_markets::entry),
    );
    
    let (banks_client, payer, recent_blockhash) = program_test.start().await;
    
    TestContext {
        banks_client,
        payer,
        recent_blockhash,
        program_id,
    }
}
