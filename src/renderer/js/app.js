const ROUTES = {
    dashboard: renderDashboard,
    profiles: renderProfiles,
    customers: renderCustomers,
    artikel: renderArtikel,
    invoices: renderInvoices,
    belege: renderBelege,
    mahnungen: renderMahnungen,
    notizen: renderNotizen,
    statistik: renderStatistik,
    suche: renderSuche,
    export: renderExport,
    einstellungen: renderEinstellungen
};

// Zerlegt den Hash in Routenname und Query-Parameter, z.B. "#/customers?id=5"
// -> { route: 'customers', params: { id: '5' } }. Wird u.a. für die
// Kundendetailansicht und die Suchergebnisse (Suchbegriff) benötigt.
function aktuelleRouteUndParams() {
    const hash = window.location.hash.replace(/^#\//, '');
    const [routenName, queryString] = hash.split('?');
    const route = ROUTES[routenName] ? routenName : 'dashboard';
    const params = {};
    if (queryString) {
        for (const [key, value] of new URLSearchParams(queryString)) params[key] = value;
    }
    return { route, params };
}

async function router() {
    const { route, params } = aktuelleRouteUndParams();
    document.querySelectorAll('.nav-link').forEach((link) => {
        link.classList.toggle('aktiv', link.dataset.route === route);
    });

    const view = document.getElementById('view');
    try {
        await ROUTES[route](view, params);
    } catch (err) {
        showFehler(err.message);
    }
}

function initialisiereGlobaleSuche() {
    const formular = document.getElementById('globale-suche-formular');
    if (!formular) return;
    formular.addEventListener('submit', (event) => {
        event.preventDefault();
        const begriff = formular.q.value.trim();
        window.location.hash = `#/suche?q=${encodeURIComponent(begriff)}`;
    });
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
    initialisiereGlobaleSuche();
    await pruefeLoginGate();
    if (!window.location.hash) window.location.hash = '#/dashboard';
    router();
});
