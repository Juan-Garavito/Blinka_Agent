/**
 * Divide el texto de una página en segmentos según rangos [start, end) de evidencias (pueden solaparse).
 * Devuelve [{ text, ids: [] }]; los rangos inválidos o fuera del texto se ignoran (nunca se inventan posiciones).
 */
export function segmentText(text, ranges) {
  const valid = ranges.filter((r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= text.length);
  const cuts = new Set([0, text.length]);
  for (const r of valid) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const ids = valid.filter((r) => r.start <= a && r.end >= b).map((r) => r.id);
    const prev = out.at(-1);
    if (prev && prev.ids.length === 0 && ids.length === 0) prev.text += text.slice(a, b);
    else out.push({ text: text.slice(a, b), ids });
  }
  return out;
}
