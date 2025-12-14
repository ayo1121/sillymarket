import app, { migrate, cleanupExpiredNonces, DATABASE_URL } from "./app.js";
import { startPumpfunCutoffWorker } from "./pumpfunCutoffWorker.js";

const PORT = Number(process.env.PORT || 8787);
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:8080";

migrate().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ API listening on http://localhost:${PORT}  (CORS: ${APP_ORIGIN})`);
    if (DATABASE_URL && !DATABASE_URL.includes("REPLACE_WITH")) {
      console.log(`✅ Database: connected`);
    } else {
      console.log(`⚠️  Database: not configured (update DATABASE_URL in .env)`);
    }
    console.log("");

    // ✅ SECURITY: Start nonce cleanup job
    // Run immediately on startup
    cleanupExpiredNonces();
    // Run every hour
    setInterval(cleanupExpiredNonces, 60 * 60 * 1000);
    console.log("✅ Nonce cleanup job: started (runs hourly)");

    // ✅ Start Pump.fun cutoff worker (monitors livestream status)
    if (DATABASE_URL && !DATABASE_URL.includes("REPLACE_WITH")) {
      startPumpfunCutoffWorker();
      console.log("✅ Pump.fun cutoff worker: started");
    }
  });
}).catch((e: any) => {
  console.error("\n❌ Migration failed:", e.message);
  console.error("\nTo fix this:");
  console.error("1. Update DATABASE_URL in server/.env with your Supabase connection string");
  console.error("2. Make sure REPLACE_WITH_DB_PASSWORD is replaced with your actual password");
  console.error("3. Then restart the server: npm run dev\n");
  process.exit(1);
});
