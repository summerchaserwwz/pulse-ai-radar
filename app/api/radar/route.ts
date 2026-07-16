import { InvalidRadarCursorError, loadLiveSignalPage } from "../_lib/radar";
import { getDatabase } from "../_lib/profile";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedPageSize = Number(url.searchParams.get("limit") ?? "24");
    const page = await loadLiveSignalPage(getDatabase(), {
      cursor: url.searchParams.get("cursor"),
      pageSize: Number.isFinite(requestedPageSize) ? requestedPageSize : 24,
    });
    return Response.json(
      {
        signals: page.signals,
        mode: page.total > 0 ? "live" : "demo",
        page: {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          total: page.total,
        },
        generatedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "private, max-age=60" } },
    );
  } catch (error) {
    if (error instanceof InvalidRadarCursorError) {
      return Response.json(
        { error: "分页位置无效，请重新加载", code: "invalid_cursor" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      { signals: [], mode: "demo", generatedAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
