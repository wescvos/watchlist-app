import { notFound } from "next/navigation";
import { getTitle } from "@/lib/titles";
import { TitleDetail } from "./TitleDetail";

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const title = await getTitle(id);
  if (!title) notFound();
  // Cast JSON + dates to a plain serialisable object for the client component.
  return <TitleDetail title={JSON.parse(JSON.stringify(title))} />;
}
