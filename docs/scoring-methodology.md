# Scoring methodology

All-available scores use every valid sample a provider supplied. Common-sample scores use identical location, valid time, variable, aggregation interval, and comparable lead-time buckets across all compared providers. Rankings prioritize the common sample.

Continuous metrics include MAE, RMSE, bias, and median absolute error. Wind additionally uses circular direction and u/v vector error. Precipitation uses interval-matched amount errors and threshold event scores. Probability providers may receive Brier and calibration analysis; deterministic precipitation is never invented as a probability.

Eligibility defaults to 100 samples, 30 distinct days, 20 positive rain events, and 80% coverage. Date-block bootstrap provides 95% intervals. Overlapping wide intervals lead to “statistically indistinguishable,” not a forced winner.

