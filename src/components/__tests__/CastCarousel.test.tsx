import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CastCarousel } from "@/components/CastCarousel";

const cast = [{ name: "Rufus Sewell", character: "John Murdoch", profileUrl: null }];

describe("CastCarousel", () => {
  it("does not restrict touch to horizontal panning, so vertical swipes still scroll the page", () => {
    render(<CastCarousel cast={cast} />);
    const scroller = screen.getByTestId("cast-scroller");
    // touch-pan-x alone blocks vertical scrolling for any swipe that starts on
    // the carousel. Either no restriction or both axes is fine.
    const classes = scroller.className.split(/\s+/);
    if (classes.includes("touch-pan-x")) expect(classes).toContain("touch-pan-y");
    expect(classes).toContain("overflow-x-auto");
  });
});
