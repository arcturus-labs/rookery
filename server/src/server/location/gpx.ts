export interface GpxPoint {
  lat: number;
  lon: number;
}

/** Extract `{lat, lon}` from every `<trkpt>/<wpt>/<rtept>` in a GPX document. */
export function parseGpxPoints(xml: string): GpxPoint[] {
  const points: GpxPoint[] = [];
  const tagRe = /<(?:trkpt|wpt|rtept)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrs = m[1];
    const lat = /\blat\s*=\s*"([-0-9.]+)"/.exec(attrs);
    const lon = /\blon\s*=\s*"([-0-9.]+)"/.exec(attrs);
    if (lat && lon) points.push({ lat: parseFloat(lat[1]), lon: parseFloat(lon[1]) });
  }
  return points;
}
