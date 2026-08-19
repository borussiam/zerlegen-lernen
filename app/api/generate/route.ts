import { POST as generate } from "@/app/api/ai/generate/route";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return generate(request);
}
