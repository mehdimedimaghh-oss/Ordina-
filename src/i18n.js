// Language of the waiter screens: Italian or English.
// Each waiter keeps their own language on the device; before a PIN, the device language is used.
const K = 'ordina:lang';
const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const deviceLang = () => get(K) || ((navigator.language || '').toLowerCase().startsWith('it') ? 'it' : 'en');
let lang = deviceLang();
const subs = new Set();

export const getLang = () => lang;
export const onLang = f => subs.add(f);
function apply(l) { if (l !== 'it' && l !== 'en') l = 'en'; if (l === lang) return; lang = l; document.documentElement.lang = l; subs.forEach(f => f()); }
// the user taps the button: remember it for this waiter (or for the device when nobody is logged in)
export function chooseLang(l, waiterId) { put(waiterId ? `${K}:${waiterId}` : K, l); apply(l); }
// a waiter logs in / out
export function langForWaiter(waiterId) { apply((waiterId && get(`${K}:${waiterId}`)) || deviceLang()); }
document.documentElement.lang = lang;

const D = {
  en: {
    whoAreYou: 'Who are you?', stock: 'Stock', history: 'History', more: 'More', language: 'Language', chooseTable: 'Choose table',
    tableBtn: 'Tavolo ▾', tablesBack: '‹ Tavoli', search: 'Find dish or drink…', searchLabel: 'Search the menu', clearSearch: 'Clear search',
    nothingFound: 'Nothing found. Try another word.', tapDish: 'Tap a dish to add it', items1: '1 item', itemsN: '{n} items', viewOrder: 'View order',
    justNow: 'just now', minN: '{m} min', orderedNow: 'Ordered just now', orderedAgo: 'Ordered {m} min ago', room: 'Room', loadingMenu: 'Loading the menu… (needs internet the first time)',
    add: 'Add {name}', removeOne: 'Remove one {name}', finishedKitchen: 'Finished! Check with the kitchen · {name}', lastOne: 'That was the last one · {name}',
    undo: 'Undo', undone: 'Undone', loginAgain: 'Log in again', offlineWaiting: 'Offline · {n} waiting', offline: 'Offline',
    finished: 'Finished', left: '{n} left', toServe: '{n} to serve', allServed: 'All served ✓', clientName: 'Client name', egClient: 'e.g. Rossi', egRoom: 'e.g. 214',
    building: 'Building', noItems: 'No items yet.', tapLeft: 'Tap dishes on the menu on the left.', closeAndTap: 'Close this and tap dishes on the menu.',
    oneLess: 'One less', oneMore: 'One more', served: '✓ Served', servedXY: 'Served {a}/{b}', editNote: 'Edit note', addNote: '+ Note',
    dishNote: 'Note for this dish (e.g. no pepper)', roomService: 'Room service', roomFee: 'Supplemento servizio in camera {fee}',
    kitchenNote: 'Notes for kitchen (e.g. no cheese, allergy)…', copyOrder: 'Copy order', sendReception: 'Send to reception', receptionBig: 'Reception view (big text)',
    sendHint: '“Send to reception” saves the order in History and copies it. Clients pay at reception.', deleteNoSave: 'Delete order without saving',
    tapAgainDelete: 'Tap again to delete', tableDeleted: 'Tavolo {n} deleted', orderCopied: 'Order copied', chooseBuilding: 'Choose the building: HCO or DEP',
    tableSent: 'Tavolo {n} sent · {tot} · order copied', show: 'Show', free: 'Free', openOrder: 'Open order', waitingMin: 'Waiting {m}+ min',
    openNotSent: '{open} open · {sum} not sent yet', tableLabel: 'Table {n}', tableOpen: ', open', goldHint: 'Gold tables have an open order. The number under it is the bill so far.',
    waitingUpload: 'waiting to upload', reopenedNotCounted: 'reopened · not counted', oldApp: 'old app', receptionView: 'Reception view', reopen: 'Reopen', delete: 'Delete', tapAgain: 'Tap again',
    tableReopened: 'Tavolo {n} reopened', deletePrompt: 'Delete the order of Tavolo {n} ({tot})?\nIt stays in the audit log.\nReason (optional):', orderDeleted: 'Order deleted · saved in the audit log',
    everyone: 'Everyone', totalToday: 'Total · Today', tablesSent1: '1 table sent · {i} items', tablesSentN: '{n} tables sent · {i} items', fullHistory: 'Full history & dashboard →',
    notSentYet: 'Not sent yet · not in total', goToTable: 'Go to table', sentReception: 'Sent to reception',
    nothingSent: 'Nothing sent yet today.<br>When the order is complete, open it and tap “Send to reception”.', copyDay: 'Copy day summary', dayCopied: 'Day summary copied',
    syncExpired: 'Your login expired: open More → Log out, then log in again.', syncKept: '{n} changes are kept on this device.',
    syncWaiting1: '1 change waiting to upload.', syncWaitingN: '{n} changes waiting to upload.', uploading: 'Uploading…',
    noNetKept: 'No internet: they are kept on this device and sent when internet is back.', allSaved: 'Everything saved online. Safe even if you close the app.',
    noNetNow: 'No internet now. New changes are kept on this device.',
    stockHint: 'Tap + or − to set how many portions are left. Each dish you add to an order takes one away by itself.', inStock: 'In stock', almostFinished: 'Almost finished',
    orangeWhen: 'Orange when left is', almostWarn: '“Almost finished” warning', lower: 'Lower', higher: 'Higher', stopCounting: 'stop counting', notCounted: 'Not counted',
    newDayCount: 'Start new day count', newDayHint: 'New day: tap this (all counts go back to “not counted”), then set today\'s numbers.', needsInternet: 'Needs internet: {msg}',
    tapAgainCount: 'Tap again to start new count', countStarted: 'New count started',
    pinHint: 'Choose your name, then type your 4-number PIN.', noWaiters: 'No waiters yet. The owner adds them in Owner → Waiters.', names: '‹ Names', delDigit: 'Delete digit',
    hi: 'Hi {name}!', whoWorking: 'Who is working?', changeWaiter: 'Change waiter',
    theme: 'Theme', auto: 'Auto', light: 'Light', dark: 'Dark', waiter: 'Waiter', switchWaiter: 'Switch waiter', lock: 'Lock ({name} out)', owner: 'Owner', ownerDashboard: 'Owner dashboard',
    install: 'Install the app on this device', connection: 'Connection', tryUpload: 'Try to upload now', loggedInAs: 'This device is logged in as <b>{email}</b> ({role}).',
    logoutDevice: 'Log out this device', tapAgainLogout: 'Tap again to log out', notSaved: 'Not saved: {msg}', close: 'Close', selectCopy: 'Select all and copy',
    receptionTable: 'Reception · Tavolo', waiterLbl: 'Cameriere', notSentShort: 'Not sent yet',
    waiterDevice: 'Waiter device', email: 'Email', restaurantPassword: 'Restaurant password', password: 'Password', logIn: 'Log in', loading: 'Loading…',
    staffHint: 'One time per tablet or phone. Ask the owner for the restaurant password. After this, waiters only use their PIN.',
    ownerHint: 'Owner: your own email and password. You see all the history.',
    notConnected: '<p>The app is not connected to the database yet.</p><p class="hint">Add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> in Vercel → Settings → Environment Variables, then redeploy. See SETUP.md.</p>',
    noRole: '<p>This login (<b>{email}</b>) has no role yet.</p><p class="hint">The owner must run step 4 of SETUP.md for it.</p>', logOut: 'Log out',
    errWrongLogin: 'Wrong email or password', errEmailOff: 'Email login is turned off in Supabase. Owner: Supabase → Authentication → Sign In / Providers → Email → turn it ON (keep "Allow new users to sign up" OFF).',
    errNoRole: 'This login has no role yet. The owner must give it the role "staff" or "owner" (see SETUP.md, step 4).',
    errWrongPin: 'Wrong PIN', errTooMany: 'Too many wrong PINs. Wait one minute.', errWaiterNotFound: 'Waiter not found',
    errOfflinePin: 'No internet. This waiter must log in once online on this device.', confirmLogout: '{n} changes are not uploaded yet. Log out anyway and lose them?',
    reception: 'Reception', receptionScreen: 'Reception screen', openReception: 'Reception PC? Open the reception screen',
    startRecv: 'Start the reception screen', startHint: 'Tap here to turn on the sound and the notifications for new orders.',
    newOrder: 'New order', toCharge: 'To charge', chargedBadge: 'Charged ✓ {time}', markCharged: 'Charged ✓', notCharged: 'Undo charged',
    todayTotal: 'Today', ordersN: '{n} orders', toChargeN: '{n} to charge', allCharged: 'All charged ✓', downloadExcel: 'Download Excel', exit: 'Exit',
    sound: 'Sound', on: 'On', off: 'Off', notifOn: 'Notifications: on', notifAsk: 'Turn on notifications', notifBlocked: 'Notifications are blocked by the browser: click the 🔒 next to the address and allow them. The pop-up and the sound work anyway.',
    noOrdersToday: 'No orders yet today. New orders appear here with a pop-up and a sound.', orderGone: 'Tavolo {n} ({tot}) was deleted by the owner: do not charge it',
    orderReopenedMsg: 'Tavolo {n} was reopened: wait for the new order before charging', ok: 'OK', chargedOk: 'Marked as charged', waiterShort: 'Waiter',
    exitRecv: 'Leave the reception screen?', live: 'Live', reconnecting: 'Connecting…', notifTitle: 'Tavolo {n} · {tot}', reopenedBadge: 'Reopened · do not charge',
  },
  it: {
    whoAreYou: 'Chi sei?', stock: 'Scorte', history: 'Storico', more: 'Altro', language: 'Lingua', chooseTable: 'Scegli il tavolo',
    tableBtn: 'Tavolo ▾', tablesBack: '‹ Tavoli', search: 'Cerca piatto o bevanda…', searchLabel: 'Cerca nel menu', clearSearch: 'Cancella ricerca',
    nothingFound: 'Nessun risultato. Prova un\'altra parola.', tapDish: 'Tocca un piatto per aggiungerlo', items1: '1 articolo', itemsN: '{n} articoli', viewOrder: 'Vedi ordine',
    justNow: 'adesso', minN: '{m} min', orderedNow: 'Ordinato adesso', orderedAgo: 'Ordinato {m} min fa', room: 'Camera', loadingMenu: 'Caricamento del menu… (serve internet la prima volta)',
    add: 'Aggiungi {name}', removeOne: 'Togli un {name}', finishedKitchen: 'Finito! Chiedi in cucina · {name}', lastOne: 'Era l\'ultimo · {name}',
    undo: 'Annulla', undone: 'Annullato', loginAgain: 'Accedi di nuovo', offlineWaiting: 'Offline · {n} in attesa', offline: 'Offline',
    finished: 'Finito', left: 'Ne restano {n}', toServe: '{n} da servire', allServed: 'Tutto servito ✓', clientName: 'Nome cliente', egClient: 'es. Rossi', egRoom: 'es. 214',
    building: 'Edificio', noItems: 'Ancora nessun piatto.', tapLeft: 'Tocca i piatti nel menu a sinistra.', closeAndTap: 'Chiudi e tocca i piatti nel menu.',
    oneLess: 'Uno in meno', oneMore: 'Uno in più', served: '✓ Servito', servedXY: 'Servito {a}/{b}', editNote: 'Modifica nota', addNote: '+ Nota',
    dishNote: 'Nota per questo piatto (es. senza pepe)', roomService: 'Servizio in camera', roomFee: 'Supplemento {fee}',
    kitchenNote: 'Note per la cucina (es. senza formaggio, allergie)…', copyOrder: 'Copia ordine', sendReception: 'Invia alla reception', receptionBig: 'Vista reception (testo grande)',
    sendHint: '“Invia alla reception” salva l\'ordine nello Storico e lo copia. I clienti pagano alla reception.', deleteNoSave: 'Elimina ordine senza salvare',
    tapAgainDelete: 'Tocca di nuovo per eliminare', tableDeleted: 'Tavolo {n} eliminato', orderCopied: 'Ordine copiato', chooseBuilding: 'Scegli l\'edificio: HCO o DEP',
    tableSent: 'Tavolo {n} inviato · {tot} · ordine copiato', show: 'Mostra', free: 'Libero', openOrder: 'Ordine aperto', waitingMin: 'Attesa {m}+ min',
    openNotSent: '{open} aperti · {sum} non ancora inviati', tableLabel: 'Tavolo {n}', tableOpen: ', aperto', goldHint: 'I tavoli dorati hanno un ordine aperto. Il numero sotto è il conto finora.',
    waitingUpload: 'in attesa di invio', reopenedNotCounted: 'riaperto · non conteggiato', oldApp: 'vecchia app', receptionView: 'Vista reception', reopen: 'Riapri', delete: 'Elimina', tapAgain: 'Tocca di nuovo',
    tableReopened: 'Tavolo {n} riaperto', deletePrompt: 'Eliminare l\'ordine del Tavolo {n} ({tot})?\nResta nel registro delle modifiche.\nMotivo (facoltativo):', orderDeleted: 'Ordine eliminato · salvato nel registro',
    everyone: 'Tutti', totalToday: 'Totale · Oggi', tablesSent1: '1 tavolo inviato · {i} articoli', tablesSentN: '{n} tavoli inviati · {i} articoli', fullHistory: 'Storico completo e dashboard →',
    notSentYet: 'Non ancora inviati · non nel totale', goToTable: 'Vai al tavolo', sentReception: 'Inviati alla reception',
    nothingSent: 'Niente inviato oggi.<br>Quando l\'ordine è completo, aprilo e tocca “Invia alla reception”.', copyDay: 'Copia riepilogo del giorno', dayCopied: 'Riepilogo copiato',
    syncExpired: 'Accesso scaduto: apri Altro → Esci, poi accedi di nuovo.', syncKept: '{n} modifiche restano su questo dispositivo.',
    syncWaiting1: '1 modifica in attesa di invio.', syncWaitingN: '{n} modifiche in attesa di invio.', uploading: 'Invio in corso…',
    noNetKept: 'Niente internet: restano su questo dispositivo e partono quando torna internet.', allSaved: 'Tutto salvato online. Sicuro anche se chiudi l\'app.',
    noNetNow: 'Niente internet adesso. Le nuove modifiche restano su questo dispositivo.',
    stockHint: 'Tocca + o − per indicare quante porzioni restano. Ogni piatto aggiunto a un ordine ne toglie una da solo.', inStock: 'Disponibile', almostFinished: 'Quasi finito',
    orangeWhen: 'Arancione quando ne restano', almostWarn: 'Avviso “Quasi finito”', lower: 'Meno', higher: 'Più', stopCounting: 'non contare più', notCounted: 'Non contato',
    newDayCount: 'Nuovo conteggio del giorno', newDayHint: 'Nuovo giorno: tocca qui (tutti i conteggi tornano “non contato”), poi inserisci i numeri di oggi.', needsInternet: 'Serve internet: {msg}',
    tapAgainCount: 'Tocca di nuovo per il nuovo conteggio', countStarted: 'Nuovo conteggio iniziato',
    pinHint: 'Scegli il tuo nome, poi scrivi il tuo PIN di 4 cifre.', noWaiters: 'Ancora nessun cameriere. Il titolare li aggiunge in Titolare → Camerieri.', names: '‹ Nomi', delDigit: 'Cancella cifra',
    hi: 'Ciao {name}!', whoWorking: 'Chi lavora?', changeWaiter: 'Cambia cameriere',
    theme: 'Tema', auto: 'Auto', light: 'Chiaro', dark: 'Scuro', waiter: 'Cameriere', switchWaiter: 'Cambia cameriere', lock: 'Blocca (esci {name})', owner: 'Titolare', ownerDashboard: 'Dashboard del titolare',
    install: 'Installa l\'app su questo dispositivo', connection: 'Connessione', tryUpload: 'Prova a inviare adesso', loggedInAs: 'Questo dispositivo è collegato come <b>{email}</b> ({role}).',
    logoutDevice: 'Esci da questo dispositivo', tapAgainLogout: 'Tocca di nuovo per uscire', notSaved: 'Non salvato: {msg}', close: 'Chiudi', selectCopy: 'Seleziona tutto e copia',
    receptionTable: 'Reception · Tavolo', waiterLbl: 'Cameriere', notSentShort: 'Non ancora inviato',
    waiterDevice: 'Dispositivo camerieri', email: 'Email', restaurantPassword: 'Password del ristorante', password: 'Password', logIn: 'Accedi', loading: 'Caricamento…',
    staffHint: 'Una volta sola per ogni tablet o telefono. Chiedi la password del ristorante al titolare. Dopo, i camerieri usano solo il loro PIN.',
    ownerHint: 'Titolare: la tua email e la tua password. Vedi tutto lo storico.',
    notConnected: '<p>L\'app non è ancora collegata al database.</p><p class="hint">Aggiungi <b>VITE_SUPABASE_URL</b> e <b>VITE_SUPABASE_ANON_KEY</b> in Vercel → Settings → Environment Variables, poi fai Redeploy. Vedi SETUP.md.</p>',
    noRole: '<p>Questo accesso (<b>{email}</b>) non ha ancora un ruolo.</p><p class="hint">Il titolare deve fare il passo 4 di SETUP.md.</p>', logOut: 'Esci',
    errWrongLogin: 'Email o password sbagliata', errEmailOff: 'L\'accesso con email è spento in Supabase. Titolare: Supabase → Authentication → Sign In / Providers → Email → attivalo (lascia spento "Allow new users to sign up").',
    errNoRole: 'Questo accesso non ha ancora un ruolo. Il titolare deve dargli il ruolo "staff" o "owner" (SETUP.md, passo 4).',
    errWrongPin: 'PIN sbagliato', errTooMany: 'Troppi PIN sbagliati. Aspetta un minuto.', errWaiterNotFound: 'Cameriere non trovato',
    errOfflinePin: 'Niente internet. Questo cameriere deve accedere una volta online su questo dispositivo.', confirmLogout: '{n} modifiche non sono ancora inviate. Uscire lo stesso e perderle?',
    reception: 'Reception', receptionScreen: 'Schermo reception', openReception: 'PC della reception? Apri lo schermo reception',
    startRecv: 'Avvia lo schermo reception', startHint: 'Tocca qui per attivare il suono e le notifiche dei nuovi ordini.',
    newOrder: 'Nuovo ordine', toCharge: 'Da addebitare', chargedBadge: 'Addebitato ✓ {time}', markCharged: 'Addebitato ✓', notCharged: 'Annulla addebito',
    todayTotal: 'Oggi', ordersN: '{n} ordini', toChargeN: '{n} da addebitare', allCharged: 'Tutto addebitato ✓', downloadExcel: 'Scarica Excel', exit: 'Esci',
    sound: 'Suono', on: 'Sì', off: 'No', notifOn: 'Notifiche: attive', notifAsk: 'Attiva le notifiche', notifBlocked: 'Le notifiche sono bloccate dal browser: clicca sul 🔒 accanto all\'indirizzo e consentile. Il pop-up e il suono funzionano comunque.',
    noOrdersToday: 'Ancora nessun ordine oggi. I nuovi ordini appaiono qui con un pop-up e un suono.', orderGone: 'Tavolo {n} ({tot}) è stato eliminato dal titolare: non addebitarlo',
    orderReopenedMsg: 'Tavolo {n} è stato riaperto: aspetta il nuovo ordine prima di addebitare', ok: 'OK', chargedOk: 'Segnato come addebitato', waiterShort: 'Cameriere',
    exitRecv: 'Uscire dallo schermo reception?', live: 'In diretta', reconnecting: 'Connessione…', notifTitle: 'Tavolo {n} · {tot}', reopenedBadge: 'Riaperto · non addebitare',
  },
};

export function t(key, vars) {
  const s = D[lang][key] ?? D.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
// messages that come from the database
const SERVER = { 'Wrong PIN': 'errWrongPin', 'Too many wrong PINs. Wait one minute.': 'errTooMany', 'Waiter not found': 'errWaiterNotFound' };
export const tServer = msg => (SERVER[msg] ? t(SERVER[msg]) : msg);
