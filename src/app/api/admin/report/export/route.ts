import { adminRoute } from "@/lib/api";
import { buildExport, parseFilters } from "@/lib/reports";

export const GET = adminRoute(async (_admin, req) => {
  const { buffer, fileName } = await buildExport(parseFilters(new URL(req.url).searchParams));
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
