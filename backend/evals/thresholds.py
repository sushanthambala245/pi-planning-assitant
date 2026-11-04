"""Release-gate floors, set before scoring and saved with every gate result.

These are starting defaults, NOT agreed values. Replace each one with a floor the project
owner has agreed, and record who agreed it and when, before the first scored run
(considerations §5.6 rule 3, anti-pattern "thresholds chosen after seeing the scores").
"""

AGREED_BY = "UNCONFIRMED - starting defaults; agree with the project owner before scoring"

MINIMUM = {
    "extraction.recall": 0.70,  # S3 positives found by the explicit extractor
    "extraction.precision": 0.80,  # extracted dependencies that match a labelled one
    "retrieval.hit_rate": 0.80,  # labelled evidence page in the top k
    "retrieval.mrr": 0.50,
    "known_links.recall": 0.60,  # S10 Jira links between analysed initiatives that the pipeline also finds
    "dri_backtest.recall": 0.50,  # past PI misses (S8) that the capacity rule would have flagged
}
