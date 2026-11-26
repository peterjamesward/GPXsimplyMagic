// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createTrackHoverCard } from "../src/trackHoverCard";
import { getTrackHoverLayout } from "../src/trackHoverLayout";

describe("createTrackHoverCard", () => {
  it("renders readable route details and positions the card in the viewer", () => {
    const host = document.createElement("div");
    const card = createTrackHoverCard(host);
    const layout = getTrackHoverLayout({ x: 120, y: 80 }, { width: 800, height: 600 });

    expect(layout).not.toBeNull();
    card.setPoint({
      x: 1,
      y: 2,
      z: 3,
      pointNumber: 42,
      distanceMeters: 3_210,
      gradientPercent: 2.5,
      altitudeMeters: 987.4,
    });
    card.setLayout(layout!, { x: 10, y: 15 });
    card.show();

    expect(card.element.hidden).toBe(false);
    expect(card.element.textContent).toContain("TRACK POINT 42");
    expect(card.element.textContent).toContain("3.21 km");
    expect(card.element.textContent).toContain("+2.5%");
    expect(card.element.textContent).toContain("987 m");
    expect(card.element.style.left).toBe(`${10 + layout!.left}px`);
    expect(card.element.style.top).toBe(`${15 + layout!.top}px`);

    card.hide();
    expect(card.element.hidden).toBe(true);
  });
});