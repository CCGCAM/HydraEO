export const INDEX_DEFINITIONS = Object.freeze({
  NDVI: { formula: "(NIR - Red) / (NIR + Red)", bands: ["nir", "red"], units: "unitless" },
  NDRE: { formula: "(NIR - RedEdge) / (NIR + RedEdge)", bands: ["nir", "rededge"], units: "unitless" },
  GNDVI: { formula: "(NIR - Green) / (NIR + Green)", bands: ["nir", "green"], units: "unitless" },
  SAVI: { formula: "((NIR - Red) / (NIR + Red + L)) * (1 + L)", bands: ["nir", "red"], units: "unitless", parameter: "L" }
});

export function availableClientIndices(dataset) {
  if (!dataset.client_computation?.allowed) return [];
  const bands = new Set(dataset.bands.filter((band) => band.calibrated).flatMap((band) =>
    [band.name, band.common_name].filter(Boolean).map((name) => name.toLowerCase())
  ));
  return Object.entries(INDEX_DEFINITIONS).filter(([, definition]) =>
    definition.bands.every((band) => bands.has(band)) &&
    (!definition.parameter || dataset.client_computation?.parameters?.[definition.parameter] !== undefined)
  ).map(([id, definition]) => ({ id, ...definition }));
}

export function describeIndex(index) {
  return {
    title: index.title || index.id,
    formula: index.formula || "not provided",
    bands: Array.isArray(index.bands_used) && index.bands_used.length ? index.bands_used.join(", ") : "not provided",
    units: index.units || "not provided",
    method: index.method === "client" ? "computed in browser" : "precomputed"
  };
}
