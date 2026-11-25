import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function AppShellPlaceholder() {
  return (
    <div className="mc-shell">
      <span>MeetingCopilot UI Next</span>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <AppShellPlaceholder />
    </StrictMode>
  );
}
