# Heritage Statement Drafter (NPPF & GPA3 Studio)

A zero-backend, client-side drafting studio that combines live **Historic England Open Data (NHLE, Conservation Areas, Heritage at Risk)** and **Archaeology Data Service (ADS / DataCite)** grey literature with local or BYOK LLMs (**Local Ollama**, **Anthropic Claude**, or **OpenAI / OpenRouter**) to draft grounded Desk-Based Heritage Statements.

Designed as a companion to [Heritage Constraints Screener](https://github.com/portableant/heritage-constraints-screener): import any GeoJSON exported from the Screener, or search any UK postcode directly.

## Running with Local Ollama on GitHub Pages

1. Pull a compact model suitable for fast local drafting:
   ```bash
   ollama pull qwen2.5:3b
2. Allow browser requests from your GitHub Pages origin (https://<username>.github.io) or web address:
* macOS: launchctl setenv OLLAMA_ORIGINS "https://portableant.github.io,http://localhost:*" (then restart Ollama)
* Linux / Windows: OLLAMA_ORIGINS="https://portableant.github.io,http://localhost:*" ollama serve
3. Open the app, verify the green Local Ollama connected indicator, and click Draft Full Statement.

## Licences & Data Attribution

Contains Historic England Open Data © Historic England, released under the Open Government Licence v3.0 (OGL v3).
Archaeological grey literature metadata retrieved via the DataCite REST API (bl.ads).
AI-generated text is an analytical drafting aid only; verify all statutory List Entry numbers and designations prior to formal Local Planning Authority submission.