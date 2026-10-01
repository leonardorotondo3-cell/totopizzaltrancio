/* Rimette nel database il menu di Totò leggendolo dal sito pubblicato.

   Il sito è la copia buona: i prezzi li ha presi dal volantino. Il server
   ricalcola da solo il totale di ogni ordine, quindi finché il database
   resta indietro il cliente vede un prezzo e il server ne pretende un
   altro. Questo script riallinea i due.

   Prima si pubblica il sito, poi si lancia questo. In ordine inverso non
   serve a niente.

     DATABASE_URL=... node rifai-menu-toto.mjs            # dice cosa farebbe
     DATABASE_URL=... node rifai-menu-toto.mjs --davvero  # lo fa

   Opzioni: --sito <url>   per puntare a un sito diverso (le prove)
            --negozio <slug>
*/
import pg from 'pg';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DAVVERO = process.argv.includes('--davvero');
const SITO    = arg('--sito', 'https://totopizzaltrancio.onrender.com');
const SLUG    = arg('--negozio', 'toto-trancio');

/* ---------- il listino, preso dalla pagina ------------------------------
   Nel sito MENU e AGGIUNTE sono scritti come JSON puro proprio perché
   qualcuno da fuori li possa rileggere senza eseguire la pagina. */
function blocco(html, nome){
  const apre = html.indexOf('const ' + nome + ' = ');
  if (apre < 0) throw new Error('nella pagina non c\'è ' + nome);
  const da = html.indexOf(nome === 'TAGLIE' ? '{' : '[', apre);
  const chiude = html.indexOf(nome === 'TAGLIE' ? '\n};' : '];', da);
  if (chiude < 0) throw new Error(nome + ' non finisce');
  return html.slice(da, chiude + 1);
}

function etichette(html){
  /* TAGLIE è JavaScript, non JSON: qui serve solo la riga sotto il nome */
  const t = blocco(html, 'TAGLIE');
  const leggi = s => (t.match(new RegExp("'" + s + "'[^}]*?sotto:\\s*'([^']*)'")) || [])[1] || '';
  return { '6': leggi('6'), '4': leggi('4') };
}

const cent = e => Math.round(e * 100);

function righe(menu, sotto){
  const out = [];
  menu.forEach((v, i) => {
    for (const taglia of ['6', '4', 'u']) {
      const p = v.p[taglia];
      if (p == null) continue;
      const senzaAggiunte = v.c !== 'classiche' && v.c !== 'speciali';
      const nome = taglia === 'u' ? v.n : v.n + ' · 1/' + taglia;
      out.push({
        key: i + '-' + taglia,
        category: v.c,
        name: nome,
        descr: v.d || null,
        price: p,
        price_cents: cent(p),
        noExtras: senzaAggiunte,
        size: taglia,
        sizeLabel: taglia === 'u' ? null : (sotto[taglia] || null),
        slug: v.f
      });
    }
  });
  return out;
}

/* ---------- controlli prima di toccare qualcosa ---------- */
function controlla(righe, aggiunte){
  const male = [];
  if (righe.length < 30) male.push('solo ' + righe.length + ' righe: la pagina sembra incompleta');
  for (const r of righe){
    if (!(r.price_cents > 0))  male.push('prezzo non valido: ' + r.name);
    if (r.price_cents > 5000)  male.push('prezzo sospetto (' + r.price + ' €): ' + r.name);
    if (!r.name || !r.key)     male.push('riga senza nome o chiave');
  }
  const chiavi = new Set(righe.map(r => r.key));
  if (chiavi.size !== righe.length) male.push('ci sono chiavi doppie');
  if (!aggiunte.length) male.push('nessuna aggiunta trovata');
  for (const a of aggiunte) if (!(a.p >= 0)) male.push('aggiunta senza prezzo: ' + a.n);
  return male;
}

/* ------------------------------------------------------------------ */
const html = await fetch(SITO + '/?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } })
  .then(r => { if (!r.ok) throw new Error(SITO + ' risponde ' + r.status); return r.text(); });

let menu, aggiunte, sotto, rr;
try {
  menu     = JSON.parse(blocco(html, 'MENU'));
  aggiunte = JSON.parse(blocco(html, 'AGGIUNTE'));
  sotto    = etichette(html);
  rr       = righe(menu, sotto);
} catch (e) {
  /* una pagina che non si legge e' una pagina di cui non fidarsi: meglio
     lasciare il listino vecchio che scriverne uno mezzo vuoto */
  console.error('Mi fermo, la pagina non torna:');
  console.error('  . ' + e.message);
  process.exit(1);
}

const male = controlla(rr, aggiunte);
if (male.length){
  console.error('Mi fermo, la pagina non torna:');
  for (const m of male.slice(0, 8)) console.error('  · ' + m);
  process.exit(1);
}

const prezzi = [...new Set(aggiunte.map(a => a.p))];
const extras = {
  list: aggiunte.map(a => a.n),
  /* un prezzo solo per tutte: «per ogni ingrediente aggiunto 1,00 €» */
  ...(prezzi.length === 1
        ? { standard: { base: prezzi[0], premium: prezzi[0] } }
        : { prices: Object.fromEntries(aggiunte.map(a => [a.n, a.p])) })
};

console.log('Dal sito ' + SITO);
console.log('  ' + menu.length + ' voci di menu → ' + rr.length + ' righe con le taglie');
console.log('  ' + aggiunte.length + ' aggiunte' +
            (prezzi.length === 1 ? ', tutte a ' + prezzi[0].toFixed(2) + ' €' : ', a prezzi diversi'));
for (const q of rr.slice(0, 3)) console.log('  es. ' + q.key + '  ' + q.name + '  ' + q.price.toFixed(2) + ' €');

if (!DAVVERO){
  console.log('\nProva a vuoto. Per scrivere davvero: aggiungi --davvero');
  process.exit(0);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL,
                         ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')
                              ? false : { rejectUnauthorized: false } });
const c = await db.connect();
try {
  await c.query('begin');
  const neg = await c.query('select id, name from shops where slug = $1', [SLUG]);
  if (!neg.rowCount) throw new Error('negozio ' + SLUG + ' non trovato');
  const shop = neg.rows[0].id;

  const prima = await c.query('select count(*)::int n from menu_items where shop_id = $1', [shop]);
  await c.query('delete from menu_items where shop_id = $1', [shop]);

  for (const r of rr){
    await c.query(
      `insert into menu_items
         (shop_id, item_key, category, name, descr, price_cents, active, no_extras, flavor_extra_cents, raw)
       values ($1,$2,$3,$4,$5,$6,true,$7,0,$8)`,
      [shop, r.key, r.category, r.name, r.descr, r.price_cents, r.noExtras,
       JSON.stringify({ category: r.category, descr: r.descr, key: r.key, name: r.name,
                        noExtras: r.noExtras, price: r.price, size: r.size,
                        sizeLabel: r.sizeLabel, slug: r.slug })]);
  }
  await c.query('update shops set extras_config = $2 where id = $1', [shop, JSON.stringify(extras)]);
  await c.query('commit');
  console.log('\n' + neg.rows[0].name + ': ' + prima.rows[0].n + ' righe vecchie → ' + rr.length + ' nuove.');
  console.log('Aggiunte riscritte: ' + extras.list.length + '.');
} catch (e) {
  await c.query('rollback');
  console.error('\nNiente scritto, è tornato tutto come prima. Motivo: ' + e.message);
  process.exitCode = 1;
} finally {
  c.release(); await db.end();
}
