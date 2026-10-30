import Link from "next/link";
import type { MouseEventHandler } from "react";
import type { ChatTitle } from "@/lib/chat/messages";

interface Props {
  title: ChatTitle;
  senderRating: number | null;
  viewerStatus: "WANT" | "WATCHED" | null;
  /** Who the rating belongs to: "You" on my own cards, else the sender's first name. */
  raterName: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/** Where a card leads: the viewer's own title page when listed, else the preview. */
export function chatTitleHref(title: ChatTitle, viewerStatus: Props["viewerStatus"]): string {
  return viewerStatus
    ? `/title/${title.id}`
    : `/preview/${title.mediaType.toLowerCase()}/${title.tmdbId}`;
}

export function ChatTitleCard({ title, senderRating, viewerStatus, raterName, onClick }: Props) {
  const status =
    viewerStatus === "WANT" ? "On your Want list"
    : viewerStatus === "WATCHED" ? "On your Watched list"
    : null;

  return (
    <Link
      href={chatTitleHref(title, viewerStatus)}
      onClick={onClick}
      className="flex w-64 max-w-full gap-3 rounded-2xl border border-black/10 bg-background p-2 transition-opacity [touch-action:manipulation] active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/15"
    >
      {/* Fixed size so a late-loading poster never shifts the thread's scroll position. */}
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
        {title.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={title.posterUrl.replace("/w500/", "/w185/")} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 text-sm font-medium">{title.title}</p>
        {title.year != null && <p className="meta mt-0.5">{title.year}</p>}
        {senderRating != null && (
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            {raterName} rated it {senderRating}/10
          </p>
        )}
        {status && <p className="mt-0.5 text-xs text-gray-500">{status}</p>}
      </div>
    </Link>
  );
}
