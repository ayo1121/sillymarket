import React from "react";
import type { UIMarket } from "@/solana/marketMapping";
import lightbulbIcon from "@/assets/lightbulb-icon.png";
import { getMarketImageUrl } from "@/solana/marketImage";
import { getOutcomeColor } from "@/solana/outcomeColors";

export const SharePreviewMarketCard: React.FC<{ market: UIMarket }> = ({ market }) => {
  const imageUrl = getMarketImageUrl(market);

  return (
    <div
      id="share-preview-root"
      style={{
        width: 600,
        backgroundColor: '#ffffff',
        padding: '32px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        borderRadius: '8px',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Faint smiley watermark */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        opacity: 0.06,
        fontSize: '200px',
        fontWeight: 900,
        color: '#999',
        userSelect: 'none',
        zIndex: 0
      }}>
        : )
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Header with Image and Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '32px' }}>
          {/* Market Image */}
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '6px',
            overflow: 'hidden',
            border: '2px solid #8b8b8b',
            backgroundColor: 'white',
            flexShrink: 0,
            boxShadow: '2px 2px 0 rgba(0,0,0,0.2)'
          }}>
            <img
              src={imageUrl || lightbulbIcon}
              alt="market"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>

          {/* Market Title */}
          <h1 style={{
            fontWeight: 900,
            fontSize: '28px',
            lineHeight: '1.2',
            color: '#111',
            margin: 0,
            flex: 1,
            wordBreak: 'break-word'
          }}>
            {market.displayQuestion}
          </h1>
        </div>

        {/* Outcome Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {market.outcomes.map((outcome, idx) => {
            const color = getOutcomeColor(idx);
            const pool = Number(outcome.poolLamports);
            const total = Number(market.volumeLamports);
            const odds = pool > 0 ? (total / pool).toFixed(2) : '1.00';
            const probDisplay = Math.round(outcome.probability * 100);

            return (
              <div
                key={idx}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  border: '2px solid #8b8b8b',
                  backgroundColor: idx === 0 ? '#d4f4dd' : '#ffd4d4',
                  borderRadius: '6px',
                  padding: '24px',
                  boxShadow: '2px 2px 0 rgba(0,0,0,0.2)',
                  minHeight: '140px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                {/* Background probability bar */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    top: 0,
                    width: `${probDisplay}%`,
                    backgroundColor: color,
                    opacity: 0.2
                  }}
                />

                <div style={{ position: 'relative', zIndex: 10 }}>
                  {/* Label and Odds */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{
                      fontWeight: 900,
                      fontSize: '18px',
                      textTransform: 'uppercase',
                      color: '#111',
                      letterSpacing: '0.5px'
                    }}>
                      {outcome.label}
                    </span>
                    <span style={{
                      fontFamily: 'monospace',
                      fontSize: '14px',
                      fontWeight: 700,
                      color: '#666'
                    }}>
                      {odds}x
                    </span>
                  </div>

                  {/* Percentage */}
                  <div style={{
                    fontSize: '48px',
                    fontWeight: 900,
                    lineHeight: 1,
                    color,
                    textShadow: '1px 1px 0 rgba(255,255,255,0.5)'
                  }}>
                    {probDisplay}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer branding */}
        <div style={{
          marginTop: '24px',
          textAlign: 'center',
          fontSize: '14px',
          fontWeight: 700,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '1px'
        }}>
          sillymarket
        </div>
      </div>
    </div>
  );
};
