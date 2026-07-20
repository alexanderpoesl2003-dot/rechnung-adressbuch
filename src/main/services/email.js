// Extrahiert eine E-Mail-Adresse aus dem freien "Kontakt"-Feld eines Kunden
// (Telefon/Email/Sonstiges gemischt), falls eine enthalten ist.
function extractEmail(text) {
    if (!text) return '';
    const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return match ? match[0] : '';
}

// mailto: unterstützt keine Dateianhänge (kein Teil des Standards, von keinem
// gängigen Mailprogramm plattformübergreifend unterstützt). Die PDF-Datei
// wird deshalb zusätzlich im Explorer angezeigt, damit sie manuell per
// Drag & Drop angehängt werden kann.
function buildMailto(empfaenger, betreff, text) {
    // Bewusst kein URLSearchParams: das würde Leerzeichen als "+" statt als
    // "%20" kodieren (application/x-www-form-urlencoded), was mailto:-Links
    // laut RFC 6068 nicht korrekt interpretieren - manche Mailprogramme
    // zeigen dann wörtliche Pluszeichen statt Leerzeichen an.
    const teile = [];
    if (betreff) teile.push(`subject=${encodeURIComponent(betreff)}`);
    if (text) teile.push(`body=${encodeURIComponent(text)}`);
    return `mailto:${empfaenger || ''}${teile.length ? '?' + teile.join('&') : ''}`;
}

module.exports = { extractEmail, buildMailto };
