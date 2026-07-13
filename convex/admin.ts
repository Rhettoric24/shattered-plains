import { getAuthUserId } from "@convex-dev/auth/server";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";

type AnyCtx = QueryCtx | MutationCtx;

declare const process: {
  env: Record<string, string | undefined>;
};

function configuredAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function currentAdminIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const tokenEmail = identity?.email?.toLowerCase() ?? null;
  const authUserId = await getAuthUserId(ctx);
  const authUser = authUserId ? await ctx.db.get(authUserId) : null;
  const userEmail = authUser?.email?.toLowerCase() ?? null;

  return {
    authUserId,
    email: userEmail ?? tokenEmail,
  };
}

export async function requireAdmin(ctx: AnyCtx) {
  const { email } = await currentAdminIdentity(ctx);
  const admins = configuredAdminEmails();

  if (!email || !admins.includes(email)) {
    throw new Error("Admin access required.");
  }

  return { email };
}

export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    const { authUserId, email } = await currentAdminIdentity(ctx);
    return {
      email,
      signedIn: Boolean(authUserId),
      isAdmin: Boolean(email && configuredAdminEmails().includes(email)),
    };
  },
});
