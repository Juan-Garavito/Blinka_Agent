import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AuthenticatedSession, AuthService } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";
import { requireCompanyContext } from "./company-context.js";
import type { CompanySummary, IdentityRepository } from "./identity.repository.js";
import { MAX_PASSWORD_LENGTH } from "./password.js";
import { clearSessionCookie, readSessionCookie, setSessionCookie, type SessionCookieConfig } from "./session-cookie.js";

const loginBody = z
  .object({
    email: z.string().trim().max(254).pipe(z.email()),
    password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

function sessionBody(session: AuthenticatedSession, companies: CompanySummary[]) {
  return {
    user: { id: session.userId, email: session.email },
    companies,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function identityRouter(deps: {
  auth: AuthService;
  repo: IdentityRepository;
  cookies: SessionCookieConfig;
  loginRateLimiters: RequestHandler[];
}): Router {
  const { auth, repo, cookies } = deps;
  const router = Router();

  router.post("/auth/login", ...deps.loginRateLimiters, async (req, res) => {
    const body = loginBody.parse(req.body);
    const result = await auth.login({
      ...body,
      userAgent: req.get("user-agent") ?? null,
      previousToken: readSessionCookie(req, cookies),
    });
    setSessionCookie(res, cookies, result.token, result.session.expiresAt);
    res.set("Cache-Control", "no-store").json(sessionBody(result.session, result.companies));
  });

  router.post("/auth/logout", requireAuth, async (req, res) => {
    await auth.logout(req.auth!.sessionId);
    clearSessionCookie(res, cookies);
    res.status(204).end();
  });

  router.get("/auth/session", requireAuth, async (req, res) => {
    const companies = await auth.listCompanies(req.auth!.userId);
    res.json(sessionBody(req.auth!, companies));
  });

  router.get("/companies/current", requireAuth, requireCompanyContext(repo), (req, res) => {
    res.json({ company: req.company });
  });

  return router;
}
