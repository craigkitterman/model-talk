/**
 * Firebase web config is public by design (it identifies the project; access is governed
 * by firestore.rules and Auth). Nothing here is a secret.
 */
export const COMMUNITY = {
  enabled: process.env.NEXT_PUBLIC_COMMUNITY !== "off",
  projectId: "modeltalk-site",
  apiKey: "AIzaSyCeeSyCYLmZQBi5a87WEgWQpkoRftVgVJQ",
  appId: "1:334705845004:web:7a230674011520d2af1f29",
  /** the public site that renders shared runs */
  siteUrl: process.env.NEXT_PUBLIC_COMMUNITY_SITE ?? "https://modeltalk.dev",
  /** set NEXT_PUBLIC_FIREBASE_EMULATOR=1 to talk to local emulators (pnpm emu) */
  emulator: process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === "1",
};

export const endpoints = () =>
  COMMUNITY.emulator
    ? {
        identity: "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1",
        secure: "http://127.0.0.1:9099/securetoken.googleapis.com/v1",
        firestore: `http://127.0.0.1:8080/v1/projects/${COMMUNITY.projectId}/databases/(default)/documents`,
      }
    : {
        identity: "https://identitytoolkit.googleapis.com/v1",
        secure: "https://securetoken.googleapis.com/v1",
        firestore: `https://firestore.googleapis.com/v1/projects/${COMMUNITY.projectId}/databases/(default)/documents`,
      };
