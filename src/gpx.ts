export type TrackPoint = Readonly<{
  latitude: number;
  longitude: number;
  elevationMeters: number;
}>;

export type Track = Readonly<{
  name: string;
  points: readonly TrackPoint[];
}>;

const elementsNamed = (parent: Element | Document, localName: string): readonly Element[] => {
  const namespaced = Array.from(parent.getElementsByTagNameNS("*", localName));
  return namespaced.length > 0 ? namespaced : Array.from(parent.getElementsByTagName(localName));
};

const firstChildText = (parent: Element, localName: string): string | undefined => {
  const child = elementsNamed(parent, localName)[0];
  const text = child?.textContent?.trim();
  return text || undefined;
};

const readCoordinate = (point: Element, attribute: "lat" | "lon", index: number): number => {
  const rawValue = point.getAttribute(attribute);
  const value = rawValue === null || rawValue.trim() === "" ? Number.NaN : Number(rawValue);
  const inRange = attribute === "lat" ? Math.abs(value) <= 90 : Math.abs(value) <= 180;

  if (!Number.isFinite(value) || !inRange) {
    throw new Error(`Track point ${index} has an invalid ${attribute === "lat" ? "latitude" : "longitude"}.`);
  }

  return value;
};

export const parseGpx = (xml: string): Track => {
  if (xml.trim() === "") {
    throw new Error("The selected file is empty.");
  }

  const document = new DOMParser().parseFromString(xml, "application/xml");
  const root = document.documentElement;

  if (
    root.localName === "parsererror" ||
    root.tagName.toLowerCase() === "parsererror" ||
    elementsNamed(document, "parsererror").length > 0
  ) {
    throw new Error("The selected file is not valid GPX XML.");
  }

  if (root.localName.toLowerCase() !== "gpx") {
    throw new Error("The selected file does not have a GPX root element.");
  }

  const pointElements = elementsNamed(root, "trkpt");
  if (pointElements.length < 2) {
    throw new Error("This GPX file needs at least two track points.");
  }

  const points = pointElements.map((element, index): TrackPoint => {
    const elevationText = firstChildText(element, "ele");
    const elevationMeters = elevationText === undefined ? 0 : Number(elevationText);

    if (!Number.isFinite(elevationMeters)) {
      throw new Error(`Track point ${index + 1} has an invalid elevation.`);
    }

    return Object.freeze({
      latitude: readCoordinate(element, "lat", index + 1),
      longitude: readCoordinate(element, "lon", index + 1),
      elevationMeters,
    });
  });

  const firstTrack = elementsNamed(root, "trk")[0];
  const name = firstTrack === undefined ? undefined : firstChildText(firstTrack, "name");

  return Object.freeze({
    name: name ?? "Untitled ride",
    points: Object.freeze(points),
  });
};

export const getTrackSummary = (points: readonly TrackPoint[]): Readonly<{
  distanceKm: number;
  elevationGainMeters: number;
}> => {
  const earthRadiusMeters = 6_371_000;
  const totals = points.slice(1).reduce(
    (summary, point, index) => {
      const previous = points[index];
      const latitudeDelta = ((point.latitude - previous.latitude) * Math.PI) / 180;
      const rawLongitudeDelta = ((point.longitude - previous.longitude) * Math.PI) / 180;
      const longitudeDelta = Math.atan2(Math.sin(rawLongitudeDelta), Math.cos(rawLongitudeDelta));
      const previousLatitude = (previous.latitude * Math.PI) / 180;
      const latitude = (point.latitude * Math.PI) / 180;
      const haversine =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(previousLatitude) * Math.cos(latitude) * Math.sin(longitudeDelta / 2) ** 2;
      const segmentMeters = earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

      return {
        distanceMeters: summary.distanceMeters + segmentMeters,
        elevationGainMeters:
          summary.elevationGainMeters + Math.max(0, point.elevationMeters - previous.elevationMeters),
      };
    },
    { distanceMeters: 0, elevationGainMeters: 0 },
  );

  return Object.freeze({
    distanceKm: totals.distanceMeters / 1000,
    elevationGainMeters: totals.elevationGainMeters,
  });
};