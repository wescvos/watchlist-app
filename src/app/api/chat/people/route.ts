import { NextResponse } from "next/server";
import { listPeople } from "@/lib/chat/people";
import { withUser } from "@/lib/chat/route";

export async function GET() {
  return withUser(async (userId) => NextResponse.json(await listPeople(userId)));
}
