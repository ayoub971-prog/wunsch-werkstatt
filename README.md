# Wunsch-Werkstatt

Web-App (PWA): Wunsch eintippen oder sprechen, eine Gratis-KI baut daraus eine kleine HTML-App.

- Gratis-Schluessel (Gemini, Groq, Mistral, OpenRouter) bleiben nur im Browser des Geraets (localStorage).
- Fallback-Kette aus `models.json`; bei 429/5xx/Netzwerkfehler automatisch naechstes Modell, mit kurzer Zusammenfassung.
- Pruefung jeder App (HTML parsen, Syntax, 2 s Testlauf im abgeschirmten iframe), bis 2 Selbstkorrekturen.
- Datenschutz-Filter ersetzt Schluessel, Passwoerter, IP-Adressen durch `[REDACTED_SECRET]`.
- Woechentlicher Workflow aktualisiert `models.json` (OpenRouter ohne Schluessel; Gemini/Groq/Mistral nur mit optionalen Repo-Secrets).

Grenzen: kleine Apps klappen gut, grosse Programme (Server, Login, Datenbank) schaffen Gratis-KIs nicht zuverlaessig.
