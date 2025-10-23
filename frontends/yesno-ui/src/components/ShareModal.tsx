// components/ShareModal.tsx
import React from 'react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareTitle: string | null;
  shareUrl: string | null;
  shareImg: string | null;
  onCopyLink: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  shareTitle,
  shareUrl,
  shareImg,
  onCopyLink,
}) => {
  if (!isOpen) return null;

  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    shareTitle || 'Check this prediction market'
  )}&url=${encodeURIComponent(shareUrl || '')}`;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      
      <div className="relative frame max-w-2xl w-full bg-white shadow-2xl">
        <div className="titlebar">
          <div className="title truncate">Share Market</div>
          <div className="controls">
            <button className="btn95-ghost" onClick={onClose}>✕</button>
          </div>
        </div>
        
        <div className="frame-body p-4 space-y-4">
          {/* Preview Section */}
          <div className="text-center">
            <h3 className="font-bold text-lg mb-2 text-black">{shareTitle}</h3>
            
            {shareImg ? (
              <div className="border-2 border-gray-300 rounded-lg p-2 bg-white inline-block max-w-full">
                <img
                  src={shareImg}
                  alt="Market preview"
                  className="max-w-full h-auto max-h-96 object-contain mx-auto"
                  style={{ minWidth: '300px' }}
                />
              </div>
            ) : (
              <div className="sunken95 p-8 text-center bg-gray-100 min-h-[200px] flex items-center justify-center">
                <div className="text-gray-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
                  Generating preview...
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 justify-center">
            {shareUrl && (
              <>
                <button
                  className="btn95 flex items-center gap-2"
                  onClick={onCopyLink}
                >
                  📋 Copy Link
                </button>
                
                <a
                  href={twitterShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn95-ghost flex items-center gap-2 bg-[#1DA1F2] text-white hover:bg-[#1a8cd8]"
                >
                  🐦 Share on Twitter
                </a>
              </>
            )}

            {shareImg && (
              <a
                href={shareImg}
                download={`${(shareTitle || 'market').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_preview.png`}
                className="btn95-ghost flex items-center gap-2"
              >
                📥 Download Image
              </a>
            )}
          </div>

          {/* Help Text */}
          <div className="text-xs text-gray-600 text-center border-t pt-3">
            <p>
              <strong>Pro tip:</strong> Download the image and attach it directly when sharing on social media for best results.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
