import React, { useEffect } from 'react';

const CBC_CIRCLES_URL = 'https://gis.audubon.org/christmasbirdcount/';

const APPLICATION_PORTAL_URL =
  'https://netapp.audubon.org/aap/application/cbc';

const SOURCE_CODE_URL = 'https://github.com/hydrospheric0/cbc-weather';

const SUPPORT_URL = 'https://buymeacoffee.com/bartg';

export default function AboutModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="About the Christmas Bird Count Weather Tool"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="modalCard">
        <div className="modalHeader">
          <div style={{ fontWeight: 800 }}>About the Christmas Bird Count Weather Tool</div>
          <button type="button" className="modalClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modalBody">
          <p>
            The Christmas Bird Count is the nation’s longest-running community science bird project. It occurs
            December 14 to January 5 every season in over 3000 count circles. More information can be found on the{' '}
            <a
              href="https://www.audubon.org/community-science/christmas-bird-count"
              target="_blank"
              rel="noopener noreferrer"
            >
              Audubon website
            </a>
            .
          </p>

          <div style={{ marginTop: 12, fontWeight: 700 }}>
            <strong>Purpose</strong>
          </div>

          <p style={{ marginTop: 6 }}>
            This tool was developed to help count circle compilers plan their count by:
          </p>
          <ul>
            <li>Creating accurate and easy-to-share insights into the likely weather conditions during their count.</li>
            <li>
              Allow easy extraction of the observed conditions during the count for reporting purposes.
            </li>
          </ul>

          <div style={{ marginTop: 12, fontWeight: 700 }}>
            <strong>How to use</strong>
          </div>
          <p style={{ marginTop: 6 }}>
            By default the tool will request the user’s location. If permitted, the tool zooms in on the nearest
            count circle and populates the weather forecast. If the count date was published on the{' '}
            <a href={CBC_CIRCLES_URL} target="_blank" rel="noopener noreferrer">
              CBC circles by National Audubon Society
            </a>
            , the count date will be highlighted on the plot.
          </p>

          <p style={{ marginTop: 10 }}>
            Once the count has passed, the weather information for that circle’s count date will be automatically
            populated. This is the information a compiler needs to provide when filling out the count results on
            the{' '}
            <a href={APPLICATION_PORTAL_URL} target="_blank" rel="noopener noreferrer">
              Application Portal
            </a>
            .
          </p>

          <div style={{ marginTop: 12, fontWeight: 700 }}>
            <strong>Share</strong>
          </div>
          <p style={{ marginTop: 6 }}>
            If you find this tool useful, please consider sharing it with other CBC circle compilers.
          </p>

          <div style={{ marginTop: 12, fontWeight: 700 }}>
            <strong>Source code</strong>
          </div>
          <p style={{ marginTop: 6 }}>
            <a href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          </p>

          <div style={{ marginTop: 12, fontWeight: 700 }}>
            <strong>Support</strong>
          </div>
          <p style={{ marginTop: 6 }}>
            <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
              <img
                src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
                alt="Buy Me a Coffee"
                width="140"
              />
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
