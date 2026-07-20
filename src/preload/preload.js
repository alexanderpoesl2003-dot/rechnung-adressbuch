const { contextBridge, ipcRenderer } = require('electron');

// Ruft einen IPC-Handler auf und wirft bei Fehlern eine normale JS-Error,
// damit die Renderer-Seite try/catch statt manuellem ok-Check verwenden kann.
async function invoke(channel, ...args) {
    const response = await ipcRenderer.invoke(channel, ...args);
    if (!response.ok) throw new Error(response.error);
    return response.data;
}

contextBridge.exposeInMainWorld('api', {
    app: {
        version: () => invoke('app:version'),
        checkForUpdates: () => invoke('app:checkForUpdates')
    },
    profiles: {
        list: () => invoke('profiles:list'),
        get: (id) => invoke('profiles:get', id),
        create: (data) => invoke('profiles:create', data),
        update: (id, data) => invoke('profiles:update', id, data),
        remove: (id) => invoke('profiles:remove', id),
        chooseLogo: () => invoke('profiles:chooseLogo')
    },
    customers: {
        list: () => invoke('customers:list'),
        get: (id) => invoke('customers:get', id),
        create: (data) => invoke('customers:create', data),
        update: (id, data) => invoke('customers:update', id, data),
        remove: (id) => invoke('customers:remove', id),
        nextKundennummer: () => invoke('customers:nextKundennummer'),
        importCsv: () => invoke('customers:importCsv'),
        lookupOrtByPlz: (plz) => invoke('customers:lookupOrtByPlz', plz)
    },
    invoices: {
        list: () => invoke('invoices:list'),
        get: (id) => invoke('invoices:get', id),
        create: (data) => invoke('invoices:create', data),
        updateStatus: (id, status) => invoke('invoices:updateStatus', id, status),
        remove: (id) => invoke('invoices:remove', id),
        listTextBausteine: () => invoke('invoices:listTextBausteine'),
        exportPdf: (id) => invoke('invoices:exportPdf', id),
        markBezahlt: (id, data) => invoke('invoices:markBezahlt', id, data),
        offenePosten: () => invoke('invoices:offenePosten'),
        sendEmail: (id) => invoke('invoices:sendEmail', id),
        previewPdf: (id) => invoke('invoices:previewPdf', id),
        print: (id) => invoke('invoices:print', id),
        listByCustomer: (customerId) => invoke('invoices:listByCustomer', customerId),
        statistik: (params) => invoke('invoices:statistik', params),
        exportSteuerberaterCsv: (params) => invoke('invoices:exportSteuerberaterCsv', params)
    },
    search: {
        global: (query) => invoke('search:global', query)
    },
    mahnungen: {
        list: () => invoke('mahnungen:list'),
        get: (id) => invoke('mahnungen:get', id),
        create: (data) => invoke('mahnungen:create', data),
        remove: (id) => invoke('mahnungen:remove', id),
        exportPdf: (id) => invoke('mahnungen:exportPdf', id),
        sendEmail: (id) => invoke('mahnungen:sendEmail', id),
        previewPdf: (id) => invoke('mahnungen:previewPdf', id),
        print: (id) => invoke('mahnungen:print', id)
    },
    notizen: {
        list: () => invoke('notizen:list'),
        create: (data) => invoke('notizen:create', data),
        update: (id, data) => invoke('notizen:update', id, data),
        setErledigt: (id, erledigt) => invoke('notizen:setErledigt', id, erledigt),
        remove: (id) => invoke('notizen:remove', id)
    },
    backup: {
        erstellen: () => invoke('backup:erstellen')
    },
    mwstSaetze: {
        list: (profileId) => invoke('mwstSaetze:list', profileId),
        create: (profileId, data) => invoke('mwstSaetze:create', profileId, data),
        remove: (id) => invoke('mwstSaetze:remove', id)
    },
    textBausteine: {
        list: () => invoke('textBausteine:list'),
        create: (data) => invoke('textBausteine:create', data),
        update: (schluessel, data) => invoke('textBausteine:update', schluessel, data),
        remove: (schluessel) => invoke('textBausteine:remove', schluessel)
    },
    settings: {
        isPasswordSet: () => invoke('settings:isPasswordSet'),
        setPassword: (passwort) => invoke('settings:setPassword', passwort),
        verifyPassword: (passwort) => invoke('settings:verifyPassword', passwort),
        removePassword: (aktuellesPasswort) => invoke('settings:removePassword', aktuellesPasswort)
    },
    artikel: {
        list: () => invoke('artikel:list'),
        get: (id) => invoke('artikel:get', id),
        findByNr: (nr) => invoke('artikel:findByNr', nr),
        create: (data) => invoke('artikel:create', data),
        update: (id, data) => invoke('artikel:update', id, data),
        remove: (id) => invoke('artikel:remove', id)
    },
    belege: {
        typen: () => invoke('belege:typen'),
        list: (typ) => invoke('belege:list', typ),
        get: (id) => invoke('belege:get', id),
        create: (typ, data) => invoke('belege:create', typ, data),
        remove: (id) => invoke('belege:remove', id),
        exportPdf: (id) => invoke('belege:exportPdf', id),
        sendEmail: (id) => invoke('belege:sendEmail', id),
        previewPdf: (id) => invoke('belege:previewPdf', id),
        print: (id) => invoke('belege:print', id)
    }
});
