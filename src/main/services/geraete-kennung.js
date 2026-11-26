// Gerätekennung für die Lizenz-Aktivierung (siehe lizenz.js). Übertragen
// wird nie die Roh-ID des Rechners, sondern nur ein gekürzter SHA-256-Hash
// davon (aktivierung-format.js: geraetAusRohId).
//   macOS:   IOPlatformUUID  (ioreg)
//   Windows: MachineGuid     (Registry HKLM\SOFTWARE\Microsoft\Cryptography)
//   Linux:   /etc/machine-id
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { geraetAusRohId } = require('./aktivierung-format');

let cache = null;

function rohIdLesen() {
    if (process.platform === 'darwin') {
        const ausgabe = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
        const treffer = ausgabe.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
        return treffer && treffer[1];
    }
    if (process.platform === 'win32') {
        const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
        const ausgabe = execFileSync(reg, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
            { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const treffer = ausgabe.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
        return treffer && treffer[1];
    }
    for (const datei of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
            const id = fs.readFileSync(datei, 'utf8').trim();
            if (id) return id;
        } catch {
            // nächste Datei versuchen
        }
    }
    return null;
}

// Liefert die gehashte Kennung dieses Rechners oder wirft einen verständlichen Fehler.
function geraetKennung() {
    if (cache) return cache;
    let rohId = null;
    try {
        rohId = rohIdLesen();
    } catch (err) {
        console.error('Gerätekennung nicht lesbar:', err.message);
    }
    if (!rohId) {
        throw new Error('Die Kennung dieses Computers konnte nicht ermittelt werden, deshalb ist keine Aktivierung möglich. '
            + 'Bitte wenden Sie sich an AP Services.');
    }
    cache = geraetAusRohId(rohId);
    return cache;
}

module.exports = { geraetKennung };
