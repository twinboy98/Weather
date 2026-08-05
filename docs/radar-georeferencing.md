# Radar georeferencing

Status: disabled pending official validation.

The application does not turn radar colors into mm/h unless all of projection, pixel extent, palette, no-data values, time metadata, and spatial direction are confirmed in official KMA documentation. Activation additionally requires rainy and dry golden cases plus numerical comparison against an official quantitative product. A neighborhood median or configured percentile will be used instead of a single pixel.

`scripts/validate_radar_georeferencing.py` intentionally exits non-zero until those fixtures exist. RainViewer remains a labeled historical display layer and is not a substitute for KMA future QPF.

