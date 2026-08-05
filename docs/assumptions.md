# Assumptions

- Korean is the default UI language and `Asia/Seoul` is the display timezone. Persistence uses UTC.
- The demo database may seed Seoul, Incheon, and Busan because they are public benchmark locations, not personal locations.
- A KMA API key does not prove permission for long-term storage or benchmarking. Those actions remain disabled per dataset policy.
- MET Norway is the only default provider allowed for long-term normalized persistence, benchmark, and GitHub export in the initial policy document.
- Windy Testing fixtures can demonstrate UI separation of GFS and ICON but can never contribute to accuracy tables.
- No numerical KMA radar extraction is safe until official projection, extent, palette, and golden cases are verified.
- With fewer than 30 days of observations, the UI must say that the winner is undetermined.

