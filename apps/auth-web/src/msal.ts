import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const env = import.meta.env;

/** One app registration is both the SPA and the API, so the scope lives on the client id itself. */
export const apiScopes = [`api://${env.VITE_CLIENT_ID}/access_as_user`];

export const msalConfig: Configuration = {
  auth: {
    clientId: env.VITE_CLIENT_ID ?? '',
    authority: env.VITE_AUTHORITY ?? 'https://login.microsoftonline.com/common',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: { cacheLocation: 'sessionStorage' },
};

export const msal = new PublicClientApplication(msalConfig);
