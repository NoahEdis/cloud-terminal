import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const pathname = req.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isApiRoute = pathname.startsWith("/api/");
  const isDiagramsRoute = pathname.startsWith("/api/diagrams");

  // Always allow auth routes and diagrams (public)
  if (isAuthRoute || isDiagramsRoute) {
    return;
  }

  // For non-authenticated requests
  if (!isLoggedIn) {
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
