import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");

  // Always allow auth routes
  if (isAuthRoute) {
    return;
  }

  // Redirect to sign-in if not authenticated
  if (!isLoggedIn) {
    return Response.redirect(new URL("/api/auth/signin", req.nextUrl.origin));
  }
});

export const config = {
  // Protect all routes except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
