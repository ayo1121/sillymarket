import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const sections = [
  {
    title: "Acceptance of Terms",
    body: [
      "By accessing or using Sillymarket, you agree to these Terms of Service. If you do not agree, do not use the site.",
      "We may update these Terms from time to time; continued use means you accept the changes.",
    ],
  },
  {
    title: "Eligibility & Compliance",
    body: [
      "You must be at least 18 (or the legal age in your jurisdiction) and legally allowed to use on-chain prediction or wagering products.",
      "You are responsible for complying with local laws and confirming that using Sillymarket is permitted where you live.",
      "If you are restricted under sanctions or other applicable rules, you may not use the service.",
    ],
  },
  {
    title: "Wallets, Transactions & Fees",
    body: [
      "Sillymarket is non-custodial. You control your wallet, keys, and assets; losing access to your wallet means losing access to your funds.",
      "All transactions occur on the Solana blockchain. Network congestion, validator issues, or program errors can delay or prevent transactions.",
      "You are responsible for any SOL or token fees related to placing, resolving, claiming, or canceling positions.",
    ],
  },
  {
    title: "Markets, Outcomes & Disputes",
    body: [
      "Market rules, outcomes, and settlement criteria are defined in each market description. Read them before participating.",
      "Administrators may resolve, pause, void, or delist markets that are spammy, abusive, or impossible to settle.",
      "If you believe a market was resolved incorrectly, contact us through the support channels listed in the app. Resolution decisions may be final unless explicitly changed by admins.",
    ],
  },
  {
    title: "Prohibited Conduct",
    body: [
      "No market manipulation, wash trading, coordinated misinformation, or attempts to exploit oracle/settlement mechanisms.",
      "No use of automated bots that degrade performance or fairness.",
      "Do not upload or link to illegal, hateful, or infringing content.",
    ],
  },
  {
    title: "Risk Disclosure",
    body: [
      "Prediction markets carry financial risk. Prices can move quickly, and you can lose your entire stake.",
      "Digital assets are volatile, and smart contracts can fail or be exploited. Only use funds you can afford to lose.",
      "Nothing on Sillymarket is investment, legal, or tax advice.",
    ],
  },
  {
    title: "Disclaimers & Liability",
    body: [
      "Sillymarket is provided “as is” without warranties of any kind.",
      "To the fullest extent permitted by law, we are not liable for lost funds, lost profits, data loss, or other damages arising from your use of the service.",
      "Some jurisdictions do not allow certain limitations; in those cases, the limitation applies to the maximum extent permitted.",
    ],
  },
  {
    title: "Termination",
    body: [
      "We may restrict or suspend access for violations of these Terms or suspected abuse.",
      "You may stop using Sillymarket at any time; any on-chain positions remain subject to the applicable market rules.",
    ],
  },
  {
    title: "Changes to the Service",
    body: [
      "We may change, suspend, or discontinue features at any time.",
      "Material changes to these Terms will be posted on the site. Continued use after changes constitutes acceptance.",
    ],
  },
  {
    title: "Contact",
    body: [
      "For questions or disputes, reach out through the support links provided in the app. This document is informational and not legal advice.",
    ],
  },
];

const TermsOfService = () => {
  const navigate = useNavigate();
  const lastUpdated = "January 5, 2025";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="bg-[#e6e6e6] dark:bg-[#1f1f1f] border border-[#8a8a8a] dark:border-[#3a3a3a] shadow-sm rounded-[6px] p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-[#555] dark:text-[#c7c7c7]">Sillymarket</p>
              <h1 className="text-3xl font-black tracking-tight text-[#111] dark:text-white">Terms of Service</h1>
              <p className="text-xs text-[#444] dark:text-[#c7c7c7] mt-1">Last updated: {lastUpdated}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => navigate("/")}
              className="font-bold shadow-[2px_2px_0px_0px_#000] border border-[#8b8b8b] dark:border-[#3a3a3a] bg-white dark:bg-[#2a2a2a] text-[#111] dark:text-white hover:bg-[#f5f5f5] dark:hover:bg-[#3a3a3a]"
            >
              Back to markets
            </Button>
          </div>

          <div className="space-y-4">
            {sections.map((section) => (
              <section
                key={section.title}
                className="bg-white dark:bg-[#1f1f1f] border border-[#c9c9c9] dark:border-[#333] rounded-[4px] p-4 shadow-inner"
              >
                <h2 className="text-lg font-extrabold text-[#111] dark:text-white mb-2">{section.title}</h2>
                <ul className="list-disc pl-5 space-y-1 text-sm text-[#222] dark:text-[#e6e6e6] leading-relaxed">
                  {section.body.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="mt-6 text-[12px] text-[#444] dark:text-[#c7c7c7] leading-relaxed">
            Sillymarket is an experimental, on-chain prediction market product. Use it responsibly and consult your own
            counsel if you need legal advice about whether and how you may participate in your jurisdiction.
          </p>
        </div>
      </main>
    </div>
  );
};

export default TermsOfService;
