# LOL-Game-Scraper

Service adapted from scripts to collect large amounts of game data from League of Legends API for use in machine learning projects.

## Downloading Datasets

```bash
curl -H "X-API-Key: your-api-key" "http://localhost:3000/api/datasets/download?patch=16.1" -o matches-16.1.ndjson
```
