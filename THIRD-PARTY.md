# Fremder Code und Schriften

| Teil | Herkunft | Lizenz |
|---|---|---|
| `services/chunker/staatsarchiv_compat.py` | [machinelearningZH/ai-search_staatsarchiv](https://github.com/machinelearningZH/ai-search_staatsarchiv), Funktionen wörtlich übernommen; nachgebildet in `apps/web/src/lib/server/chunkAlign.ts` | MIT (unten) |
| `services/ner-xml/ner_xml.py`, `sentence_splitter.py`, `spacy_integration.py` | [machinelearningZH/named-entity-recognition_staatsarchiv](https://github.com/machinelearningZH/named-entity-recognition_staatsarchiv), teils übernommen und angepasst | MIT (unten) |
| `services/ner-xml/spacy_integration.py` | angepasst nach [tomaarsen/SpanMarkerNER](https://github.com/tomaarsen/SpanMarkerNER) (`span_marker/spacy_integration.py`) | Apache-2.0, [Text](services/ner-xml/LICENSE-SpanMarkerNER.txt) |
| `apps/web/static/fonts/bebas-neue-latin.woff2` | Bebas Neue, Ryoichi Tsunekawa (Dharma Type), Teilmenge | SIL OFL 1.1, [Text](apps/web/static/fonts/BebasNeue-OFL.txt) |
| `apps/web/static/fonts/junicode-*.woff2` | Junicode, Peter S. Baker, Teilmengen | SIL OFL 1.1, [Text](apps/web/static/fonts/Junicode-OFL.txt) |

Abhängigkeiten aus npm und PyPI sind nicht enthalten; sie tragen ihre eigenen Lizenzen. Modelle werden zur Laufzeit geladen.

## MIT License

Copyright (c) 2025 Canton of Zurich / Department of Justice and Home Affairs / Statistical Office / Team Data
(named-entity-recognition_staatsarchiv)

Copyright (c) 2026 Canton of Zurich / Department of Justice and Home Affairs / Office for Statistics and Data / Team Data
(ai-search_staatsarchiv)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
