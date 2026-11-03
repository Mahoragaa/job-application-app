import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.modify",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account }) {
      // PrismaAdapter does not automatically overwrite expired OAuth tokens
      // when an existing user re-authenticates. Explicitly persist fresh tokens:
      if (account?.provider === "google" && account.providerAccountId && account.access_token) {
        try {
          await prisma.account.updateMany({
            where: {
              provider: "google",
              providerAccountId: account.providerAccountId,
            },
            data: {
              access_token: account.access_token,
              expires_at: account.expires_at ?? null,
              token_type: account.token_type ?? null,
              scope: account.scope ?? null,
              id_token: account.id_token ?? null,
              ...(account.refresh_token ? { refresh_token: account.refresh_token } : {}),
            },
          });
        } catch (err) {
          console.warn("Could not update Google OAuth tokens on sign-in:", err);
        }
      }
      return true;
    },
    async session({ session, user }) {
      // Attach the user ID to the session for DB lookups
      session.user.id = user.id;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
});
