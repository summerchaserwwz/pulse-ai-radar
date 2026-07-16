import { handleSubscriptionAction } from "../_lib/action";

export async function GET(request: Request) {
  return handleSubscriptionAction(request, "unsubscribe");
}

export async function POST(request: Request) {
  return handleSubscriptionAction(request, "unsubscribe");
}
