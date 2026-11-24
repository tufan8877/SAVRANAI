# S.A.V.R.A.N.

**Smart Adaptive Virtual Reasoning and Assistance Network** · savran.ai

Persönlicher KI-Assistent für Deutsch und Englisch mit animiertem Three.js-Kern. React und React Three Fiber bilden die Kommandozentrale. Express liefert Frontend und API über denselben Render Web Service aus.

## Lokal starten

Node.js 24 und npm verwenden.

```sh
npm ci
cp .env.example .env
npm run dev
```

Vite läuft standardmäßig auf `http://localhost:5173`, Express auf Port 3000. Die Oberfläche startet auch ohne Anbieterschlüssel und nennt die fehlende Konfiguration. Mikrofonaufnahmen benötigen HTTPS oder localhost.

### Supabase

1. Supabase-Projekt erstellen und [die SQL-Migration](supabase/migrations/202611230001_initial.sql) über den SQL Editor oder mit der Supabase CLI anwenden.
2. Öffentliche Projekt-URL und den Anon-Key als `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` setzen. Bei Verwendung neuer Supabase-Schlüssel kann hier der Publishable Key stehen.
3. In Supabase Auth E-Mail-Anmeldung und E-Mail-Bestätigung aktivieren. Site URL auf den produktiven Ursprung setzen. `https://savran.ai/` und die gewünschten lokalen Redirect-URLs freigeben. Verifizierungs- und Reset-Links im Browser öffnen, in dem der jeweilige PKCE-Vorgang gestartet wurde.
4. Für produktive Verifizierungs- und Reset-Mails SMTP in Supabase einrichten. Den Service-Role-Key ausschließlich im Express-Backend für die Kontolöschung setzen.

### Groq und ElevenLabs

- `GROQ_API_KEY` setzen. Standardmodelle sind `openai/gpt-oss-120b` und `whisper-large-v3-turbo`. Beide Modell-IDs sind per Umgebung austauschbar. [Groq-Modellliste](https://console.groq.com/docs/models), [Groq Speech to Text](https://console.groq.com/docs/speech-to-text).
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` und bei Bedarf `ELEVENLABS_MODEL_ID` setzen. Das Standardmodell ist `eleven_flash_v2_5`. Weitere auswählbare Stimmen über `ELEVENLABS_VOICES_JSON` bereitstellen, etwa `[{"id":"VOICE_ID","name":"Stimmenname"}]`. Der ElevenLabs-Zugang muss das Ausgabeformat `pcm_24000` unterstützen.
- API-Schlüssel für Groq und ElevenLabs sowie der Supabase-Service-Role-Key gehören in die Laufzeitumgebung des Backends. Vite erhält die zwei öffentlichen Supabase-Werte beim Build.

## Bedienung

- Text schreiben oder das Mikrofon ausdrücklich aktivieren. Die Aufnahme endet über den Stopp-Button, bei Hintergrundwechsel oder spätestens nach 60 Sekunden. Eine erkannte Äußerung wird direkt als Nachricht gesendet.
- Einstellungen steuern Antwortsprache, Stimme, Lautstärke und automatisches Vorlesen. Das Vorlesen startet nach Abschluss der Textantwort und verwendet einen gestreamten PCM-Audiokanal. Der Unterbrechen-Button bricht den Stream und eingeplante Audiopuffer ab.
- Gespräche werden mit der ersten Nachricht angelegt. Im seitlichen Verlauf lassen sich Gespräche nach Titel und Nachrichtentext suchen, öffnen, umbenennen und löschen. Nachrichten lassen sich kopieren oder erneut vorlesen.
- Der aktuelle Gesprächskontext verwendet einen begrenzten Ausschnitt des Verlaufs. Das Langzeitgedächtnis ist separat und standardmäßig deaktiviert. Die Zustimmung zu jeder gespeicherten Notiz erfolgt im Gedächtnisbereich. Durch Deaktivieren werden Notizen aus Anfragen entfernt. Im Gedächtnisbereich können sie einzeln oder komplett gelöscht werden.
- Die Dateifunktion prüft PDF, UTF-8-TXT, DOCX, PNG, JPEG und WEBP serverseitig auf Format und Größe. Das Limit liegt bei 8 MB für Dateien und 10 MB für Mikrofonaufnahmen. Datei- und Bildanalyse ist deaktiviert. Dateien für die Formatprüfung werden weder gespeichert noch an Groq gesendet.
- Integrationen werden als geplant angezeigt. Für zukünftige Adapter gelten serverseitige OAuth-Autorisierung und eine ausdrückliche Bestätigung je Aktion. Das aktuelle Modell kann keine Integrationsaktionen auslösen.

## Deployment auf Render

Das Projekt in ein GitHub-Repository übernehmen und in Render als Blueprint mit [render.yaml](render.yaml) verbinden. Die dort markierten Werte und optional `ELEVENLABS_VOICES_JSON` in Render hinterlegen. Anschließend `savran.ai` als Custom Domain beim Web Service hinzufügen, DNS gemäß Render konfigurieren und in Supabase die produktiven Redirects setzen. Änderungen an Vite-Variablen benötigen einen neuen Build. Für Tests unter der Render-Standarddomain zunächst deren HTTPS-Ursprung als `APP_URL` und Supabase-Redirect hinterlegen.

Der Build kompiliert Frontend und Backend und generiert einen versionierten Service Worker. Express verwendet den von Render gelieferten `PORT`. Der Health Check liegt unter `/api/health`. Der Service Worker speichert die öffentliche App-Shell und Build-Assets. Authentifizierte Daten und API-Antworten werden über das Netz geladen. Unter iOS erfolgt die Installation über „Teilen“ und „Zum Home-Bildschirm“.

## Prüfungen

```sh
npm run typecheck
npm run build
npm test
NODE_ENV=production npm start
```

Die Tests nutzen eine eingebettete PostgreSQL-Engine für RLS, Benutzerdatentrennung und Löschkaskaden. Die API-Tests verwenden einen lokalen HTTP-Port und simulieren Authentifizierung, Groq und ElevenLabs. Ein Web-Audio-Test prüft PCM-Samples, Pegel und Unterbrechung. Nach einem Build prüft der Produktions-Smoke-Test den Express-Start, die App-Shell, die PWA-Dateien und die Konfigurationshinweise. Auf einem konfigurierten Testprojekt zusätzlich Registrierung und Mail-Links, zwei getrennte Benutzerkonten, Mikrofonfreigabe, Streaming-Antworten, Unterbrechung und Kontolöschung prüfen. Für die visuelle Abnahme sind iOS Safari, Android Chrome und ein Desktop-Browser mit WebGL vorgesehen. Dort auch Offline-Start, Installation und reduzierte Bewegung testen.
