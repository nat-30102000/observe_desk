import { EventType, type AuthenticationResult } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { msal } from './msal';
import './styles.css';

void msal.initialize().then(() => {
  const first = msal.getAllAccounts()[0];
  if (first && !msal.getActiveAccount()) msal.setActiveAccount(first);
  msal.addEventCallback((e) => {
    if (e.eventType === EventType.LOGIN_SUCCESS && e.payload) msal.setActiveAccount((e.payload as AuthenticationResult).account);
  });
  createRoot(document.getElementById('root')!).render(
    <MsalProvider instance={msal}>
      <App />
    </MsalProvider>,
  );
});
