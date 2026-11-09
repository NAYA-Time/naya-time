'use strict';
const { config, pruefeConfig } = require('./config');
const { erstelleApp } = require('./app');

pruefeConfig();
const { app, aufraeumen } = erstelleApp(config);

app.listen(config.port, () => {
  console.log(`NAYA TIME läuft auf Port ${config.port} (Daten: ${config.datenOrdner})`);
});

// Alte Fotos einmal beim Start und danach täglich löschen.
aufraeumen();
setInterval(aufraeumen, 24 * 60 * 60 * 1000).unref();
