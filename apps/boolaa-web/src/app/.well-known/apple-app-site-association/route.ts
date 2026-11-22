import { appleAppSiteAssociation } from "@/lib/app-links";

// Apple's CDN fetches this without an extension; it must be JSON, unredirected, over HTTPS.
export function GET() {
  return Response.json(appleAppSiteAssociation(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
