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

## Standard-Login

Für eine einfache Demo ist der Login immer verfügbar als:

- Benutzername: `admin`
- Passwort: `admin`

Hinweis: Beim Serverstart wird der `admin`-User auf diese Werte synchronisiert,
damit die Anmeldung zuverlässig funktioniert (unabhängig von Umgebungsvariablen).
