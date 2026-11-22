import { assetLinks } from "@/lib/app-links";

// Android App Links verification (autoVerify) for https://boolaa.ro/join/*.
export function GET() {
  return Response.json(assetLinks(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
