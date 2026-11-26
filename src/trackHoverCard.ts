import type { TrackRoutePoint } from "./trackGeometry";
import type { TrackHoverLayout } from "./trackHoverLayout";

type Offset = Readonly<{ x: number; y: number }>;

const panelWidth = 360;

export const createTrackHoverCard = (container: HTMLElement): Readonly<{
  element: HTMLDivElement;
  setPoint: (point: TrackRoutePoint) => void;
  setLayout: (layout: TrackHoverLayout, offset: Offset) => void;
  show: () => void;
  hide: () => void;
}> => {
  const document = container.ownerDocument;
  const element = document.createElement("div");
  element.className = "track-hover-card";
  element.setAttribute("role", "status");
  element.setAttribute("aria-label", "Track point details");
  element.hidden = true;

  const title = document.createElement("strong");
  title.className = "track-hover-card-title";
  element.append(title);

  const details = document.createElement("dl");
  details.className = "track-hover-details";
  const createRow = (label: string): HTMLElement => {
    const row = document.createElement("div");
    row.className = "track-hover-row";
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    row.append(term, value);
    details.append(row);
    return value;
  };
  const distance = createRow("Distance");
  const gradient = createRow("Gradient");
  const altitude = createRow("Altitude");
  element.append(details);
  container.append(element);

  return Object.freeze({
    element,
    setPoint: (point: TrackRoutePoint): void => {
      title.textContent = `TRACK POINT ${point.pointNumber.toLocaleString()}`;
      distance.textContent = `${(point.distanceMeters / 1000).toFixed(2)} km`;
      gradient.textContent = point.gradientPercent === null
        ? "—"
        : `${point.gradientPercent > 0 ? "+" : ""}${point.gradientPercent.toFixed(1)}%`;
      altitude.textContent = `${Math.round(point.altitudeMeters).toLocaleString()} m`;
    },
    setLayout: (layout: TrackHoverLayout, offset: Offset): void => {
      element.style.left = `${offset.x + layout.left}px`;
      element.style.top = `${offset.y + layout.top}px`;
      element.style.width = `${layout.width}px`;
      element.style.height = `${layout.height}px`;
      const scale = layout.width / panelWidth;
      element.style.padding = `${16 * scale}px ${20 * scale}px`;
      element.style.fontSize = `${14 * scale}px`;
      title.style.fontSize = `${15 * scale}px`;
      details.style.marginTop = `${14 * scale}px`;
      details.style.gap = `${5 * scale}px`;
    },
    show: (): void => {
      element.hidden = false;
    },
    hide: (): void => {
      element.hidden = true;
    },
  });
};