# MyOwnHub

Ein kleiner Website-Hub mit Login und SQLite-Datenbank.

## Features

- Login über Benutzerkonto
- SQLite-Datenbank für User und Websites
- Nur Admin darf:
  - neue User hinzufügen
  - Websites anlegen, bearbeiten, löschen
- Normale User dürfen sich anmelden und Websites lesen/öffnen

## Start

```bash
npm install
npm start
```

Server läuft danach standardmäßig auf `http://localhost:3000`.

## Initialer Admin

Beim ersten Start wird automatisch ein Admin erstellt:

- Benutzername: `admin`
- Passwort: `admin123` (oder Wert von `ADMIN_PASSWORD`)

Bitte Passwort in einer echten Umgebung sofort ändern.
