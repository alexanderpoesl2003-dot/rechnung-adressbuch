// Weitere Belegarten neben der Rechnung (deren Nummernkreis weiterhin über
// sender_profiles.naechste_laufnummer läuft). "hatPositionen" bedeutet: der
// Beleg wird über eine Positionstabelle (beleg_positionen) erstellt.
// "zeigtPreise" steuert, ob die PDF-Ausgabe Preise/Summen enthält
// (Lieferscheine weisen üblicherweise keine Preise aus).
const BELEG_TYPEN = {
    angebot: { prefix: 'AN', bezeichnung: 'Angebot', hatPositionen: true, zeigtPreise: true },
    auftragsbestaetigung: { prefix: 'AB', bezeichnung: 'Auftragsbestätigung', hatPositionen: true, zeigtPreise: true },
    lieferschein: { prefix: 'LI', bezeichnung: 'Lieferschein', hatPositionen: true, zeigtPreise: false },
    korrektur: { prefix: 'KO', bezeichnung: 'Korrektur-Rechnung', hatPositionen: true, zeigtPreise: true },
    barbeleg: { prefix: 'BB', bezeichnung: 'Barbeleg', hatPositionen: true, zeigtPreise: true },
    mahnung: { prefix: 'MA', bezeichnung: 'Mahnung', hatPositionen: false, zeigtPreise: false }
};

module.exports = { BELEG_TYPEN };
