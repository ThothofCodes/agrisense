# 🔑 Clerk OAuth / Social Login Setup

This guide walks through enabling **Google**, **GitHub**, and **Apple** as social login providers on the AgriSense sign-in page.

The Clerk `<SignIn>` and `<SignUp>` components already have the UI and styling for social login buttons — they appear automatically when the corresponding OAuth provider is enabled in the Clerk Dashboard. Once configured, the sign-in page shows:

```
┌─────────────────────────────┐
│  Continue with Google    🔵 │
│  Continue with GitHub    ⬛ │
│  Continue with Apple     ⚫ │
│  ────── or ──────           │
│  Email address  [________]  │
│  Password       [________]  │
│  [Sign In]                  │
└─────────────────────────────┘
```

## Prerequisites

- A Clerk account and application (create one at [dashboard.clerk.com](https://dashboard.clerk.com))
- `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` set in your `.env` file

## Step 1: Enable Social Login in Clerk Dashboard

1. Log into [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your AgriSense application
3. Navigate to **User & Authentication → Social Login**
4. Click **"Add connection"** for each provider you want to enable

## Step 2: Configure Each Provider

### Google

| Field | Value |
|-------|-------|
| **Redirect URI** | `https://[your-domain].clerk.accounts.dev/v1/oauth_callback` |
| *(or the custom domain shown in Clerk)* | |

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project or select an existing one
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Set Application type to **Web application**
6. Add the **Authorized redirect URI** from Clerk's Google config page
7. Copy the **Client ID** and **Client Secret** into Clerk's form

### GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App** or select an existing one
3. Set **Homepage URL** to `https://agrisense.app` (your production URL)
4. Set **Authorization callback URL** to the redirect URI shown in Clerk (e.g., `https://[your-domain].clerk.accounts.dev/v1/oauth_callback`)
5. Copy the **Client ID** and generate a **Client Secret**
6. Paste both into Clerk's GitHub config form

### Apple

| Field | Value |
|-------|-------|
| **Bundle ID** | `com.ruaitechsolutions.agrisense` (or your app's bundle ID) |
| **Services ID** | `com.ruaitechsolutions.agrisense.service` |

1. Go to [Apple Developer Portal](https://developer.apple.com)
2. Navigate to **Certificates, Identifiers & Profiles → Identifiers**
3. Register a new **Services ID** (for web sign-in)
4. Enable **Sign in with Apple**
5. Configure the **Redirect URL** from Clerk's Apple config page
6. Copy the **Services ID**, **Team ID**, **Key ID**, and **Private Key** into Clerk's form

## Step 3: Configure Redirect URLs

In Clerk Dashboard, navigate to **Sessions → Redirect URLs** and add:

| URL | Purpose |
|-----|---------|
| `http://localhost:5173` | Local development |
| `http://localhost:5173/dashboard` | Post-login redirect (dev) |
| `https://agrisense.app` | Production |
| `https://agrisense.app/dashboard` | Post-login redirect (prod) |

The app already passes `afterSignInUrl="/dashboard"` and `afterSignUpUrl="/dashboard"` to both the `<ClerkProvider>` and the `<SignIn>`/`<SignUp>` components, so users always land on the dashboard after authentication.

## Step 4: Verify the Flow

1. Start the development server: `cd apps/web && npm run dev`
2. Navigate to `http://localhost:5173/login`
3. You should see the social login buttons above the email/password form
4. Click **"Continue with Google"** (or GitHub/Apple)
5. Complete the OAuth flow in the provider's popup
6. Verify you're redirected to `http://localhost:5173/dashboard`
7. The sidebar should show your name from the social provider

## Troubleshooting

### Social buttons don't appear
- Verify the provider is enabled in Clerk Dashboard → Social Login
- Verify `VITE_CLERK_PUBLISHABLE_KEY` is set
- Check the browser console for Clerk SDK errors
- Clear `localStorage` and hard-refresh the page

### OAuth callback error (redirect_uri_mismatch)
- Double-check the redirect URI in the provider's OAuth app matches exactly what Clerk shows
- For local dev, the URI should not include `localhost` — use the Clerk-proxied domain

### User authenticated but not redirected
- Check that `afterSignInUrl="/dashboard"` is set on `<ClerkProvider>` (in `main.tsx`)
- Ensure the `/dashboard` route exists in the router

### CORS errors on the callback
- The redirect URI must be an exact match (including trailing slashes)
- Clerk handles the OAuth callback server-side, so CORS shouldn't be an issue in most cases

## Security Notes

- **Never commit OAuth client secrets** to the repository
- **Use different OAuth apps** for development and production (different Client IDs/Secrets)
- **Restrict redirect URIs** to only the domains you control
- Clerk manages the OAuth token exchange server-side, so access tokens are never exposed to the browser
- Social login emails are verified by the provider — Clerk skips the email verification step for OAuth users

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/main.tsx` | ClerkProvider with `afterSignInUrl`, `afterSignUpUrl`, `signInUrl` |
| `apps/web/src/pages/Pages.tsx` | SignIn and SignUp components with social button styling |
| `apps/web/src/App.tsx` | ProtectedRoute using Clerk's `useAuth()` |
| `apps/web/src/components/layout/AppLayout.tsx` | Syncs Clerk session token to axios interceptor |
| `.env.example` | Environment variable template |
| `apps/api/src/routes/webhooks.ts` | Clerk webhook handlers for user sync |

---

*AgriSense Smart Farming System — Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.*
