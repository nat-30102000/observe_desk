import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const env = import.meta.env;

export const apiScopes = [`api://${env.VITE_API_CLIENT_ID}/access_as_user`];

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
