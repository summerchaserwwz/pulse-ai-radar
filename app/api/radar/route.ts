import { loadLiveSignals } from "../_lib/radar";
import { getDatabase } from "../_lib/profile";

export async function GET() {
  try {
    const signals = await loadLiveSignals(getDatabase());
    return Response.json(
      {
        signals,
        mode: signals.length > 0 ? "live" : "demo",
        generatedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "private, max-age=60" } },
    );
  } catch {
    return Response.json(
      { signals: [], mode: "demo", generatedAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
