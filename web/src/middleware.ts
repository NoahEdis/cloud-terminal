import { auth } from "@/auth";

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/api/auth",
  "/api/browser",
  "/api/diagrams",
  "/api/graph",
  "/api/sync",
  "/api/brain",
  "/browser",
  "/brain",
  "/integrations",
  "/demo",
  "/",
];

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const pathname = req.nextUrl.pathname;

  // Check if route is public
  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    pathname === route || pathname.startsWith(route + "/")
  );

  // Always allow public routes
  if (isPublicRoute) {
    return;
  }

  // For non-authenticated requests to protected routes
  if (!isLoggedIn) {
    const isApiRoute = pathname.startsWith("/api/");
    // Return 401 for API routes (don't redirect)
    if (isApiRoute) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Redirect to sign-in for page routes
    return Response.redirect(new URL("/api/auth/signin", req.nextUrl.origin));
  }
});

export const config = {
  // Protect all routes except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
