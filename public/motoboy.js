// Garra Delivery — Motoboy PWA Logic
const SUPABASE_URL = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.url : 'https://faowxiyxjfogkoynsohj.supabase.co';
const SUPABASE_KEY = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.key : 'sb_publishable_UFy_HB0JaKUVCvHUlHSQ0Q_2HFOk4_V';

let db = null;
let currentRider = null;  // fleet row of logged-in motoboy
let riderMap = null;      // Leaflet map instance
let realtimeChannel = null;
let watchId = null;       // geolocation watch ID
let lastPosition = null;  // { lat, lng }
let hasCenteredOnce = false;
let knownActiveTeleIds = null; // IDs of active deliveries to play chime on new arrivals
let currentPendingTele = null; // Current pending tele displayed in the modal

// ─── INIT ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (window.supabase) {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  lucide.createIcons();
  registerSW();

  // Check for persisted session
  const saved = localStorage.getItem('speedMotoSession');
  if (saved) {
    try {
      currentRider = JSON.parse(saved);
      showApp();
      loadMyDeliveries();
      startGeolocation();
    } catch {
      localStorage.removeItem('speedMotoSession');
    }
  }
});

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('Notification API not supported by browser.');
    return;
  }
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        showPWAToast('Notificações ativadas! 🔔');
      }
    });
  }
}

function sendWebNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    console.log('Notifications not permitted or not supported.');
    return;
  }

  // Try showing notification via Service Worker registration
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body: body,
        icon: '/logo.png',
        badge: '/logo.png',
        vibrate: [200, 100, 200],
        tag: 'speed-delivery-notif',
        renotify: true
      });
    }).catch(err => {
      console.warn("ServiceWorker notification failed, fallback to Notification construct:", err);
      new Notification(title, { body, icon: '/logo.png' });
    });
  } else {
    new Notification(title, { body, icon: '/logo.png' });
  }
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────

async function handleMotoLogin(e) {
  e.preventDefault();

  const rawId  = document.getElementById('moto-id').value.trim().toUpperCase();
  const pin    = document.getElementById('moto-pin').value.trim();
  const btn    = document.getElementById('login-btn');
  const errEl  = document.getElementById('login-error');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerText = 'Verificando...';

  if (!db) {
    showLoginError('Serviço indisponível. Tente novamente.');
    btn.disabled = false;
    btn.innerText = 'Entrar';
    return;
  }

  // The ID stored in Supabase is like "#MB-123" — normalize input
  const motoboyId = rawId.startsWith('#') ? rawId : '#' + rawId;

  const { data, error } = await db
    .from('fleet')
    .select('*')
    .eq('id', motoboyId)
    .eq('pin', pin)
    .maybeSingle();

  btn.disabled = false;
  btn.innerText = 'Entrar';

  if (error || !data) {
    showLoginError('ID ou PIN incorreto. Contate o administrador.');
    return;
  }

  currentRider = data;
  localStorage.setItem('speedMotoSession', JSON.stringify(data));
  showApp();
  loadMyDeliveries();
  startGeolocation();
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.innerText = msg;
  el.classList.remove('hidden');
}

function handleMotoLogout() {
  if (!confirm('Sair do aplicativo?')) return;
  localStorage.removeItem('speedMotoSession');
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  if (watchId) navigator.geolocation.clearWatch(watchId);
  currentRider = null;
  knownActiveTeleIds = null;
  hasCenteredOnce = false;
  document.getElementById('pwa-app').classList.add('hidden');
  document.getElementById('pwa-login').classList.remove('hidden');
  document.getElementById('moto-id').value = '';
  document.getElementById('moto-pin').value = '';
  // Close drawer if open
  togglePWADrawer(false);
  lucide.createIcons();
}

// ─── SCREEN TRANSITIONS ───────────────────────────────────────────────────────

function showApp() {
  document.getElementById('pwa-login').classList.add('hidden');
  document.getElementById('pwa-app').classList.remove('hidden');

  // Fill header info
  document.getElementById('pwa-rider-name').innerText = currentRider.name || 'Motoboy';
  setRiderStatusBadge(currentRider.status || 'Disponível');

  // Fill drawer info
  const drawerName = document.getElementById('drawer-rider-name');
  const drawerId = document.getElementById('drawer-rider-id');
  if (drawerName) drawerName.innerText = currentRider.name || 'Motoboy';
  if (drawerId) drawerId.innerText = currentRider.id || '#MB-0000';

  // Initialize connection button state
  updateConnectionButtonState(currentRider.status || 'Disponível');

  // Load profile details (email and photo) and weekly earnings balance
  loadLocalProfile();
  loadWeeklyBalance();

  // Request notification permissions
  requestNotificationPermission();

  // Switch to map tab by default
  hasCenteredOnce = false;
  switchPWATab('map');
  subscribeRealtime();
  updateSystemTelesCount(); // Update badge on load
  lucide.createIcons();
}

function setRiderStatusBadge(status) {
  const el = document.getElementById('pwa-rider-status');
  el.innerText = status;
  el.className = 'pwa-status-badge';
  if (status === 'Disponível') el.classList.add('badge-available');
  else if (status.includes('Descanso')) el.classList.add('badge-rest');
  else el.classList.add('badge-busy');
}

// ─── CONNECTION / STATUS TOGGLING ───────────────────────────────────────────

function updateConnectionButtonState(status) {
  const btn = document.getElementById('pwa-connect-btn');
  const statusVal = document.getElementById('map-status-val');
  
  if (!btn) return;

  if (status === 'Em Descanso') {
    btn.innerText = 'Conectar';
    btn.className = 'pwa-btn-connect-pill offline';
    if (statusVal) {
      statusVal.innerText = 'OFFLINE';
      statusVal.className = 'status-val offline';
    }
  } else {
    btn.innerText = 'Desconectar';
    btn.className = 'pwa-btn-connect-pill online';
    if (statusVal) {
      statusVal.innerText = 'ONLINE';
      statusVal.className = 'status-val online';
    }
  }
}

async function toggleConnectionState() {
  if (!db || !currentRider) return;
  const btn = document.getElementById('pwa-connect-btn');
  if (!btn) return;

  const currentStatus = currentRider.status || 'Disponível';
  
  if (currentStatus === 'Em Descanso') {
    // Connect -> change status to 'Disponível'
    btn.disabled = true;
    btn.innerText = 'Conectando...';
    
    const { error } = await db
      .from('fleet')
      .update({ status: 'Disponível', status_class: 'status-success' })
      .eq('id', currentRider.id);

    btn.disabled = false;
    if (error) {
      alert('Erro ao conectar. Tente novamente.');
      updateConnectionButtonState(currentStatus);
      return;
    }

    currentRider.status = 'Disponível';
    localStorage.setItem('speedMotoSession', JSON.stringify(currentRider));
    setRiderStatusBadge('Disponível');
    updateConnectionButtonState('Disponível');
    showPWAToast('Você está online!');
    requestNotificationPermission();
  } else {
    // Disconnect -> check if there are active deliveries
    btn.disabled = true;
    btn.innerText = 'Desconectando...';
    
    // Check if there are active deliveries for this motoboy
    const { data, error: countError } = await db
      .from('client_history')
      .select('id')
      .eq('rider', currentRider.name)
      .neq('status', 'Entregue');

    if (countError) {
      alert('Erro ao verificar status de corridas. Tente novamente.');
      btn.disabled = false;
      updateConnectionButtonState(currentStatus);
      return;
    }

    if (data && data.length > 0) {
      alert('Você tem uma entrega em andamento! Conclua-a antes de se desconectar.');
      btn.disabled = false;
      updateConnectionButtonState(currentStatus);
      return;
    }

    // Disconnect -> change status to 'Em Descanso'
    const { error } = await db
      .from('fleet')
      .update({ status: 'Em Descanso', status_class: 'status-warning' })
      .eq('id', currentRider.id);

    btn.disabled = false;
    if (error) {
      alert('Erro ao desconectar. Tente novamente.');
      updateConnectionButtonState(currentStatus);
      return;
    }

    currentRider.status = 'Em Descanso';
    localStorage.setItem('speedMotoSession', JSON.stringify(currentRider));
    setRiderStatusBadge('Em Descanso');
    updateConnectionButtonState('Em Descanso');
    showPWAToast('Você está offline.');
  }
}

// ─── TAB NAVIGATION ──────────────────────────────────────────────────────────

function switchPWATab(tab) {
  document.querySelectorAll('.pwa-tab').forEach(t => t.classList.add('hidden'));
  document.querySelectorAll('.pwa-drawer-item').forEach(b => b.classList.remove('active'));

  const tabEl = document.getElementById('pwa-tab-' + tab);
  if (tabEl) tabEl.classList.remove('hidden');

  const navEl = document.getElementById('pwa-nav-' + tab);
  if (navEl) navEl.classList.add('active');

  if (tab === 'map') {
    setTimeout(() => {
      if (!riderMap) initRiderMap();
      else riderMap.invalidateSize();
    }, 100);
  } else if (tab === 'reports') {
    loadReportsData();
  } else if (tab === 'system-teles') {
    loadSystemTeles();
  }
  lucide.createIcons();
}

// ─── DRAWER MENU NAVIGATION ──────────────────────────────────────────────────

function togglePWADrawer(isOpen) {
  const drawer = document.getElementById('pwa-drawer');
  if (!drawer) return;
  if (isOpen) {
    drawer.classList.add('active');
  } else {
    drawer.classList.remove('active');
  }
}

function handleDrawerNav(tab) {
  switchPWATab(tab);
  togglePWADrawer(false);
}

function handleDrawerLogout() {
  togglePWADrawer(false);
  handleMotoLogout();
}

// ─── LOAD DELIVERIES ─────────────────────────────────────────────────────────

async function loadMyDeliveries() {
  const container = document.getElementById('pwa-teles-container');
  container.innerHTML = `
    <div class="pwa-loading">
      <div class="pwa-spinner"></div>
      <p>Carregando teles...</p>
    </div>
  `;

  if (!db || !currentRider) return;

  const { data, error } = await db
    .from('client_history')
    .select('*')
    .eq('rider', currentRider.name)
    .neq('status', 'Entregue')
    .order('id', { ascending: false });

  if (error) {
    container.innerHTML = `<p class="pwa-empty-msg">Erro ao carregar teles. Tente novamente.</p>`;
    return;
  }

  const activeDeliveries = data || [];
  const currentIds = activeDeliveries.map(t => t.id);

  // If this is not the first check and we have newly assigned teles, play sound notification
  if (knownActiveTeleIds !== null) {
    const newTeles = currentIds.filter(id => !knownActiveTeleIds.includes(id));
    if (newTeles.length > 0) {
      playNotificationSound();
    }
  }
  knownActiveTeleIds = currentIds;

  // Update map floating badges and action buttons
  updateMapOverlays(activeDeliveries);

  renderTeleCards(activeDeliveries);
}

function renderTeleCards(deliveries) {
  const container = document.getElementById('pwa-teles-container');

  if (deliveries.length === 0) {
    container.innerHTML = `
      <div class="pwa-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        <p>Nenhuma tele ativa no momento.</p>
        <span>Aguardando despacho do administrador.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  deliveries.forEach(order => {
    const isPickup   = order.status === 'A caminho da coleta';
    const isTransit  = order.status === 'Em rota de entrega';

    const card = document.createElement('div');
    card.className = 'pwa-tele-card';
    card.innerHTML = `
      <div class="pwa-tele-header">
        <strong class="pwa-tele-id">${order.id}</strong>
        <span class="pwa-tele-status ${order.status_class || 'status-progress'}">${order.status}</span>
      </div>
      <div class="pwa-tele-body">
        <div class="pwa-tele-row">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${order.address}</span>
        </div>
        <div class="pwa-tele-row pwa-tele-meta">
          <span>Distância: <strong>${order.dist}</strong></span>
          <span>Taxa: <strong class="pwa-highlight">${order.price}</strong></span>
        </div>
      </div>
      <div class="pwa-tele-footer">
        ${isPickup ? `
          <button class="pwa-btn pwa-btn-primary" onclick="confirmPickup('${order.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a2 2 0 0 0-2 2v6c0 1.1.9 2 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            Confirmar Coleta
          </button>
        ` : ''}
        ${isTransit ? `
          <button class="pwa-btn pwa-btn-success" onclick="confirmDelivery('${order.id}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
            Confirmar Entrega
          </button>
        ` : ''}
        ${!isPickup && !isTransit ? `
          <span class="pwa-tele-waiting">Aguardando início...</span>
        ` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

// ─── DELIVERY ACTIONS ─────────────────────────────────────────────────────────

async function confirmPickup(deliveryId) {
  if (!db) return;
  const btn = event.target.closest('button');
  if (btn) { btn.disabled = true; btn.innerText = 'Confirmando...'; }

  try {
    const { data: fleetRider, error: fleetErr } = await db
      .from('fleet')
      .select('bypass_distance_limit')
      .eq('name', currentRider.name)
      .single();

    if (fleetErr) throw fleetErr;

    const bypass = fleetRider ? !!fleetRider.bypass_distance_limit : false;

    if (!bypass) {
      const { data: order, error: orderErr } = await db
        .from('client_history')
        .select('pickup_lat, pickup_lng')
        .eq('id', deliveryId)
        .single();

      if (orderErr) throw orderErr;

      if (!order || order.pickup_lat === null || order.pickup_lng === null) {
        alert('Coordenadas de coleta não encontradas para validação.');
        if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Coleta'; }
        return;
      }

      if (!lastPosition || lastPosition.lat === null || lastPosition.lng === null) {
        alert('Aguardando sua localização GPS atual. Certifique-se de que a localização está ativa.');
        if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Coleta'; }
        return;
      }

      const distance = calculateHaversineDistance(
        lastPosition.lat, lastPosition.lng,
        parseFloat(order.pickup_lat), parseFloat(order.pickup_lng)
      );

      if (distance > 3.0) {
        alert(`Você está a ${distance.toFixed(2)} km do local de coleta. A coleta só pode ser confirmada se você estiver a menos de 3 km do local.`);
        if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Coleta'; }
        return;
      }
    }
  } catch (err) {
    console.error("Erro na validação de distância:", err);
    alert('Erro ao validar distância de segurança. Tente novamente.');
    if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Coleta'; }
    return;
  }

  const { error } = await db
    .from('client_history')
    .update({ status: 'Em rota de entrega', status_class: 'status-progress' })
    .eq('id', deliveryId);

  if (error) {
    alert('Erro ao confirmar coleta. Tente novamente.');
    if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Coleta'; }
    return;
  }

  // Update fleet rider status
  await db
    .from('fleet')
    .update({ status: 'Em rota de entrega', status_class: 'status-progress' })
    .eq('name', currentRider.name);

  currentRider.status = 'Em rota de entrega';
  localStorage.setItem('speedMotoSession', JSON.stringify(currentRider));
  setRiderStatusBadge('Em rota de entrega');
  showPWAToast('Coleta confirmada! Boa entrega.');
  loadMyDeliveries();
}

async function confirmDelivery(deliveryId) {
  if (!db) return;
  const btn = event.target.closest('button');
  if (btn) { btn.disabled = true; btn.innerText = 'Finalizando...'; }

  try {
    const { data: fleetRider, error: fleetErr } = await db
      .from('fleet')
      .select('bypass_distance_limit')
      .eq('name', currentRider.name)
      .single();

    if (fleetErr) throw fleetErr;

    const bypass = fleetRider ? !!fleetRider.bypass_distance_limit : false;

    if (!bypass) {
      const { data: order, error: orderErr } = await db
        .from('client_history')
        .select('dest_lat, dest_lng')
        .eq('id', deliveryId)
        .single();

      if (orderErr) throw orderErr;

      if (!order || order.dest_lat === null || order.dest_lng === null) {
        alert('Coordenadas de entrega não encontradas para validação.');
        if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Entrega'; }
        return;
      }

      if (!lastPosition || lastPosition.lat === null || lastPosition.lng === null) {
        alert('Aguardando sua localização GPS atual. Certifique-se de que a localização está ativa.');
        if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Entrega'; }
        return;
      }

      const distance = calculateHaversineDistance(
        lastPosition.lat, lastPosition.lng,
        parseFloat(order.dest_lat), parseFloat(order.dest_lng)
      );

      if (distance > 3.0) {
        alert(`Você está a ${distance.toFixed(2)} km do local de entrega. A entrega só pode ser finalizada se você estiver a menos de 3 km do local.`);
        if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Entrega'; }
        return;
      }
    }
  } catch (err) {
    console.error("Erro na validação de distância:", err);
    alert('Erro ao validar distância de segurança. Tente novamente.');
    if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Entrega'; }
    return;
  }

  const { error: histErr } = await db
    .from('client_history')
    .update({ status: 'Entregue', status_class: 'status-success' })
    .eq('id', deliveryId);

  if (histErr) {
    alert('Erro ao finalizar entrega. Tente novamente.');
    if (btn) { btn.disabled = false; btn.innerText = 'Confirmar Entrega'; }
    return;
  }

  await db
    .from('fleet')
    .update({ status: 'Disponível', status_class: 'status-success', delivery: 'Nenhuma' })
    .eq('name', currentRider.name);

  currentRider.status = 'Disponível';
  localStorage.setItem('speedMotoSession', JSON.stringify(currentRider));
  setRiderStatusBadge('Disponível');
  showPWAToast(`Entrega ${deliveryId} concluída!`);
  loadMyDeliveries();
}

// ─── REALTIME SUBSCRIPTION ────────────────────────────────────────────────────

function subscribeRealtime() {
  if (!db || !currentRider) return;
  if (realtimeChannel) db.removeChannel(realtimeChannel);

  realtimeChannel = db.channel('moto-realtime-' + currentRider.id)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'client_history'
    }, (payload) => {
      const riderName = currentRider.name;
      
      if (payload.eventType === 'INSERT') {
        if (payload.new.rider === riderName) {
          sendWebNotification("Nova Tele Atribuída! 🏍️", `A tele ${payload.new.id} foi atribuída a você.`);
          playNotificationSound();
          loadMyDeliveries();
        }
      } else if (payload.eventType === 'DELETE') {
        const wasMine = payload.old && (payload.old.rider === riderName || (knownActiveTeleIds && knownActiveTeleIds.includes(payload.old.id)));
        if (wasMine) {
          sendWebNotification("Tele Removida! ❌", `A tele ${payload.old.id} foi removida de você.`);
          playNotificationSound();
          loadMyDeliveries();
        }
      } else if (payload.eventType === 'UPDATE') {
        const wasMine = payload.old && payload.old.rider === riderName;
        const isMine = payload.new && payload.new.rider === riderName;
        
        if (!wasMine && isMine) {
          sendWebNotification("Nova Tele Atribuída! 🏍️", `A tele ${payload.new.id} foi atribuída a você.`);
          playNotificationSound();
          loadMyDeliveries();
        } else if (wasMine && !isMine) {
          sendWebNotification("Tele Removida! ❌", `A tele ${payload.new.id} foi removida de você.`);
          playNotificationSound();
          loadMyDeliveries();
        } else if (isMine) {
          loadMyDeliveries();
        }
      }
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'pending_deliveries'
    }, (payload) => {
      playNotificationSound();
      sendWebNotification("Nova Tele no Sistema! 🔔", `Uma nova tele de ${payload.new.client || 'comércio'} está disponível.`);
      updateSystemTelesCount();
      showPWAToast(`Nova tele disponível no sistema: ${payload.new.id}`);
      if (document.getElementById('pwa-tab-system-teles') && !document.getElementById('pwa-tab-system-teles').classList.contains('hidden')) {
        loadSystemTeles();
      }
    })
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'pending_deliveries'
    }, (payload) => {
      updateSystemTelesCount();
      if (document.getElementById('pwa-tab-system-teles') && !document.getElementById('pwa-tab-system-teles').classList.contains('hidden')) {
        loadSystemTeles();
      }
      if (currentPendingTele && currentPendingTele.id === payload.old.id) {
        closePendingTeleModal();
        showPWAToast(`A tele ${payload.old.id} não está mais disponível.`);
      }
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'pending_deliveries'
    }, (payload) => {
      const tele = payload.new;
      updateSystemTelesCount();
      if (document.getElementById('pwa-tab-system-teles') && !document.getElementById('pwa-tab-system-teles').classList.contains('hidden')) {
        loadSystemTeles();
      }

      // If bidding started and not yet assigned
      if (tele.bidding_started_at) {
        const startTime = new Date(tele.bidding_started_at).getTime();
        const nowTime = new Date().getTime();
        const elapsed = nowTime - startTime;
        const remaining = 10000 - elapsed;

        if (remaining > 0) {
          setTimeout(async () => {
            if (db) {
              await db.rpc('assign_delivery_to_closest_rider', { p_delivery_id: tele.id });
            }
          }, remaining);
        } else {
          if (db) {
            db.rpc('assign_delivery_to_closest_rider', { p_delivery_id: tele.id });
          }
        }
      }
    })
    .subscribe();
}

function showPendingTeleModal(tele) {
  currentPendingTele = tele;
  
  const idEl = document.getElementById('pending-tele-id');
  const clientEl = document.getElementById('pending-tele-client');
  const addressEl = document.getElementById('pending-tele-address');
  const distEl = document.getElementById('pending-tele-dist');
  const priceEl = document.getElementById('pending-tele-price');
  
  if (idEl) idEl.innerText = tele.id || '';
  if (clientEl) clientEl.innerText = tele.client || 'Garra Coleta';
  if (addressEl) addressEl.innerText = tele.address || 'Destino';
  if (distEl) distEl.innerText = tele.dist || '0 km';
  if (priceEl) priceEl.innerText = tele.price || 'R$ 0,00';
  
  const modal = document.getElementById('pwa-pending-tele-modal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closePendingTeleModal() {
  const modal = document.getElementById('pwa-pending-tele-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  currentPendingTele = null;
}

async function acceptSelectedPendingTele() {
  if (!db || !currentRider || !currentPendingTele) return;
  
  if (!lastPosition) {
    alert("Para aceitar a tele, por favor ative seu GPS e permita o acesso à localização.");
    return;
  }

  // Verificar limite de entregas simultâneas
  try {
    const { data: activeDeliveries, error: countErr } = await db
      .from('client_history')
      .select('id')
      .eq('rider', currentRider.name)
      .neq('status', 'Entregue');

    if (countErr) throw countErr;

    const count = activeDeliveries ? activeDeliveries.length : 0;

    const { data: fleetData, error: limitErr } = await db
      .from('fleet')
      .select('max_simultaneous_deliveries')
      .eq('id', currentRider.id)
      .maybeSingle();

    if (limitErr) throw limitErr;

    const limit = fleetData ? (parseInt(fleetData.max_simultaneous_deliveries) || 1) : 1;

    if (count >= limit) {
      alert(`Você atingiu o limite de entregas simultâneas (${limit}). Conclua suas entregas ativas antes de aceitar uma nova.`);
      return;
    }
  } catch (err) {
    console.error("Erro ao verificar limite de entregas simultâneas:", err);
  }

  const btn = document.getElementById('pending-tele-accept-btn');
  const oldText = btn ? btn.innerText : 'Aceitar';
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Registrando Aceite...';
  }
  
  const tele = currentPendingTele;
  
  try {
    // 1. Calculate distance from rider to pickup point (restaurant)
    const pickupLat = parseFloat(tele.pickup_lat) || -23.55052;
    const pickupLng = parseFloat(tele.pickup_lng) || -46.633308;
    const distToPickup = calculateHaversineDistance(lastPosition.lat, lastPosition.lng, pickupLat, pickupLng);

    // 2. Insert bid to delivery_bids table
    const { error: bidErr } = await db
      .from('delivery_bids')
      .insert([{
        delivery_id: tele.id,
        rider_id: currentRider.id,
        rider_name: currentRider.name,
        distance_to_pickup: distToPickup
      }]);

    if (bidErr) {
      console.error("Error inserting bid:", bidErr);
      alert("Erro ao registrar seu aceite. Tente novamente.");
      if (btn) {
        btn.disabled = false;
        btn.innerText = oldText;
      }
      return;
    }

    // 3. Try to start the 10-second bidding window atomically if not already started
    const { data: updateData, error: updateErr } = await db
      .from('pending_deliveries')
      .update({ bidding_started_at: new Date().toISOString() })
      .eq('id', tele.id)
      .is('bidding_started_at', null)
      .select();

    if (updateErr) {
      console.error("Error setting bidding window start time:", updateErr);
    }

    // If this client successfully started the bidding window, start local 10s assignment execution fallback
    if (updateData && updateData.length > 0) {
      setTimeout(async () => {
        if (db) {
          await db.rpc('assign_delivery_to_closest_rider', { p_delivery_id: tele.id });
        }
      }, 10000);
    }

    // 4. Update button UI to show confirmation waiting status
    if (btn) {
      btn.innerText = 'Aguardando Aproximação...';
      btn.style.background = '#8e8e9f';
    }
    
    showPWAToast("Aceite registrado! Analisando motoboy mais próximo (~10 segundos)...");
    
    // Close modal after 3 seconds so motoboy returns to map while waiting
    setTimeout(() => {
      closePendingTeleModal();
    }, 3000);

  } catch (err) {
    console.error('Error accepting tele:', err);
    alert('Erro de conexão ao aceitar tele.');
    if (btn) {
      btn.disabled = false;
      btn.innerText = oldText;
    }
  }
}

// ─── MAP ─────────────────────────────────────────────────────────────────────

function initRiderMap() {
  const mapEl = document.getElementById('pwa-map');
  if (!mapEl) return;

  riderMap = L.map('pwa-map', { zoomControl: true, attributionControl: false }).setView([-23.55052, -46.633308], 14);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
  }).addTo(riderMap);

  if (lastPosition) {
    placeRiderMarker(lastPosition.lat, lastPosition.lng);
  }
}

let riderMarker = null;

function placeRiderMarker(lat, lng) {
  if (!riderMap) return;

  const iconHtml = `
    <div style="width:22px;height:22px;background:#ffb700;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px rgba(255,183,0,0.7);display:flex;align-items:center;justify-content:center;">
      <div style="width:6px;height:6px;background:#fff;border-radius:50%;"></div>
    </div>
  `;
  const icon = L.divIcon({ html: iconHtml, className: '', iconSize: [22, 22], iconAnchor: [11, 11] });

  if (riderMarker) {
    riderMarker.setLatLng([lat, lng]);
  } else {
    riderMarker = L.marker([lat, lng], { icon }).addTo(riderMap);
    riderMarker.bindPopup(`<strong>${currentRider ? currentRider.name : 'Você'}</strong><br>Sua localização atual`);
  }

  if (!hasCenteredOnce) {
    riderMap.setView([lat, lng], 15);
    hasCenteredOnce = true;
  }
}

function startGeolocation() {
  if (!navigator.geolocation) return;

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      lastPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (riderMap) placeRiderMarker(lastPosition.lat, lastPosition.lng);

      // Update location in Supabase fleet table in real-time
      if (db && currentRider) {
        await db
          .from('fleet')
          .update({ lat: lastPosition.lat, lng: lastPosition.lng })
          .eq('id', currentRider.id);
      }
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

// ─── TOAST ───────────────────────────────────────────────────────────────────

function showPWAToast(msg) {
  let container = document.getElementById('pwa-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'pwa-toast-container';
    container.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:90%;max-width:360px;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = 'background:#181820;border-left:4px solid #ffb700;border:1px solid #272732;border-left:4px solid #ffb700;color:#f4f4f5;padding:14px 18px;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.4);font-size:0.9rem;font-weight:500;text-align:center;';
  toast.innerText = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── NOTIFICATION AUDIO SYNTHESIZER ──────────────────────────────────────────

let audioContextUnlocked = false;
function unlockAudioContext() {
  if (audioContextUnlocked) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        audioContextUnlocked = true;
        document.removeEventListener('click', unlockAudioContext);
        document.removeEventListener('touchstart', unlockAudioContext);
      });
    } else {
      audioContextUnlocked = true;
      document.removeEventListener('click', unlockAudioContext);
      document.removeEventListener('touchstart', unlockAudioContext);
    }
  } catch (e) {
    console.error('AudioContext unlock failed:', e);
  }
}
document.addEventListener('click', unlockAudioContext);
document.addEventListener('touchstart', unlockAudioContext);

function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const now = ctx.currentTime;
    
    // Play a crisp bell chime 3 times (constant bell ringing)
    for (let i = 0; i < 3; i++) {
      const startTime = now + i * 0.75; // 750ms spacing between rings
      const duration = 0.55;
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, startTime); // D5
      
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, startTime); // A5 (consonant fifth)
      
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.55, startTime + 0.04); // Quick attack
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration); // Smooth decay
      
      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc1.start(startTime);
      osc1.stop(startTime + duration);
      osc2.start(startTime);
      osc2.stop(startTime + duration);
    }
  } catch (error) {
    console.error('Error playing notification sound:', error);
  }
}

// ─── PROFILE AND STATS HELPERS ───────────────────────────────────────────────

let localProfileImage = null;
let currentPeriod = 'day';
let riderHistory = [];

function loadLocalProfile() {
  if (!currentRider) return;
  const localAvatar = localStorage.getItem(`speedRiderAvatar_${currentRider.id}`);
  const localEmail = localStorage.getItem(`speedRiderEmail_${currentRider.id}`) || 'motoboy@speedlog.com.br';
  
  localProfileImage = localAvatar || null;

  // Update Drawer Profile Image
  const drawerImg = document.getElementById('drawer-avatar-img');
  const drawerPlaceholder = document.getElementById('drawer-avatar-placeholder');
  if (localAvatar && drawerImg && drawerPlaceholder) {
    drawerImg.src = localAvatar;
    drawerImg.classList.remove('hidden');
    drawerPlaceholder.classList.add('hidden');
  } else if (drawerImg && drawerPlaceholder) {
    drawerImg.classList.add('hidden');
    drawerPlaceholder.classList.remove('hidden');
  }

  // Update Floating Map Profile Image
  const mapImg = document.getElementById('map-avatar-img');
  const mapPlaceholder = document.getElementById('map-avatar-placeholder');
  if (localAvatar && mapImg && mapPlaceholder) {
    mapImg.src = localAvatar;
    mapImg.classList.remove('hidden');
    mapPlaceholder.classList.add('hidden');
  } else if (mapImg && mapPlaceholder) {
    mapImg.classList.add('hidden');
    mapPlaceholder.classList.remove('hidden');
  }

  // Pre-fill Profile Edit Form
  const profileName = document.getElementById('profile-name');
  const profileEmail = document.getElementById('profile-email');
  const profilePin = document.getElementById('profile-pin');
  const profileUrl = document.getElementById('profile-avatar-url');
  
  if (profileName) profileName.value = currentRider.name || '';
  if (profileEmail) profileEmail.value = localEmail;
  if (profilePin) profilePin.value = currentRider.pin || '';
  if (profileUrl) profileUrl.value = (localAvatar && !localAvatar.startsWith('data:')) ? localAvatar : '';

  updateProfilePreview(localAvatar);
}

function updateProfilePreview(imgSrc) {
  const profileImg = document.getElementById('profile-avatar-img');
  const profilePlaceholder = document.getElementById('profile-avatar-placeholder');
  if (imgSrc && profileImg && profilePlaceholder) {
    profileImg.src = imgSrc;
    profileImg.classList.remove('hidden');
    profilePlaceholder.classList.add('hidden');
  } else if (profileImg && profilePlaceholder) {
    profileImg.classList.add('hidden');
    profilePlaceholder.classList.remove('hidden');
  }
}

// ─── FILE UPLOAD AND PHOTO LINK HANDLING ────────────────────────────────────

function handleProfileUrlInput(url) {
  localProfileImage = url.trim() || null;
  updateProfilePreview(localProfileImage);
}

function handleProfileImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    localProfileImage = e.target.result;
    updateProfilePreview(localProfileImage);
    const urlInput = document.getElementById('profile-avatar-url');
    if (urlInput) urlInput.value = ''; // clear URL input to avoid confusion
  };
  reader.readAsDataURL(file);
}

function clearProfileImage() {
  localProfileImage = null;
  updateProfilePreview(null);
  const fileInput = document.getElementById('profile-file-input');
  const urlInput = document.getElementById('profile-avatar-url');
  if (fileInput) fileInput.value = '';
  if (urlInput) urlInput.value = '';
}

async function saveProfileChanges(event) {
  event.preventDefault();
  if (!db || !currentRider) return;

  const email = document.getElementById('profile-email').value.trim();
  const pin = document.getElementById('profile-pin').value.trim();
  const saveBtn = document.getElementById('save-profile-btn');

  if (pin.length !== 4 || isNaN(pin)) {
    alert('O PIN deve conter exatamente 4 dígitos numéricos.');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerText = 'Salvando...';

  // 1. Update PIN on Supabase
  const { error } = await db
    .from('fleet')
    .update({ pin })
    .eq('id', currentRider.id);

  saveBtn.disabled = false;
  saveBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
    Salvar Alterações
  `;

  if (error) {
    alert('Erro ao salvar no banco de dados. Tente novamente.');
    return;
  }

  // 2. Persist local variables (email and photo)
  localStorage.setItem(`speedRiderEmail_${currentRider.id}`, email);
  if (localProfileImage) {
    localStorage.setItem(`speedRiderAvatar_${currentRider.id}`, localProfileImage);
  } else {
    localStorage.removeItem(`speedRiderAvatar_${currentRider.id}`);
  }

  // Update session
  currentRider.pin = pin;
  localStorage.setItem('speedMotoSession', JSON.stringify(currentRider));

  // Reload profile indicators in UI
  loadLocalProfile();
  showPWAToast('Perfil atualizado com sucesso!');
  switchPWATab('map');
}

// ─── FINANCIAL CALCULATIONS AND HISTORICAL DATA ──────────────────────────────

function parseMoney(value) {
  if (!value) return 0;
  return parseFloat(String(value).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
}

function formatMoney(value) {
  return 'R$ ' + value.toFixed(2).replace('.', ',');
}

function parseOrderDate(dateText) {
  const raw = String(dateText || '').trim();
  const now = new Date();
  if (!raw) return now;
  if (raw.startsWith('Hoje')) {
    return now;
  }
  if (raw.startsWith('Ontem')) {
    const d = new Date(now);
    d.setDate(now.getDate() - 1);
    return d;
  }
  const brDate = raw.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
  if (brDate) {
    const year = brDate[3] ? parseInt(brDate[3]) : now.getFullYear();
    const month = parseInt(brDate[2]) - 1;
    const day = parseInt(brDate[1]);
    return new Date(year, month, day);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

function isDateToday(date) {
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}

function isDateInCurrentWeek(date) {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return date >= monday && date <= sunday;
}

function isDateInCurrentMonth(date) {
  const today = new Date();
  return date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}

async function loadWeeklyBalance() {
  const balanceEl = document.getElementById('drawer-weekly-balance');
  if (!db || !currentRider) return;

  const { data, error } = await db
    .from('client_history')
    .select('price, date')
    .eq('rider', currentRider.name)
    .eq('status', 'Entregue');

  if (error || !data) return;

  let totalWeekly = 0;
  data.forEach(order => {
    const orderDate = parseOrderDate(order.date);
    if (isDateInCurrentWeek(orderDate)) {
      totalWeekly += parseMoney(order.price);
    }
  });

  if (balanceEl) balanceEl.innerText = formatMoney(totalWeekly);
}

// ─── MAP INTERACTION OVERLAYS ───────────────────────────────────────────────

function centerMapOnRider() {
  if (riderMap && lastPosition) {
    riderMap.setView([lastPosition.lat, lastPosition.lng], 16);
  }
}

function updateMapOverlays(deliveries) {
  // Update badge count
  const badge = document.getElementById('map-teles-badge');
  if (badge) {
    if (deliveries.length > 0) {
      badge.innerText = deliveries.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

function triggerQuickAction() {
  const btn = document.getElementById('map-quick-action-btn');
  if (!btn) return;
  const teleId = btn.dataset.teleId;
  const status = btn.dataset.teleStatus;
  
  if (!teleId || !status) return;
  
  if (status === 'A caminho da coleta') {
    confirmPickup(teleId);
  } else if (status === 'Em rota de entrega') {
    confirmDelivery(teleId);
  }
}

// ─── REPORTS GENERATOR AND PERIOD FILTER ─────────────────────────────────────

async function loadReportsData() {
  const listContainer = document.getElementById('pwa-reports-list-container');
  if (listContainer) {
    listContainer.innerHTML = `
      <div class="pwa-loading" style="padding: 30px 0;">
        <div class="pwa-spinner"></div>
      </div>
    `;
  }

  if (!db || !currentRider) return;

  const { data, error } = await db
    .from('client_history')
    .select('*')
    .eq('rider', currentRider.name)
    .eq('status', 'Entregue')
    .order('id', { ascending: false });

  if (error || !data) {
    if (listContainer) listContainer.innerHTML = '<p class="pwa-empty-msg">Erro ao carregar histórico.</p>';
    return;
  }

  riderHistory = data;
  renderReports(currentPeriod);
}

function setReportsPeriod(period) {
  currentPeriod = period;
  
  // Update filter pills active class
  document.querySelectorAll('.pwa-reports-filters .pwa-filter-pill').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById('filter-btn-' + period);
  if (activeBtn) activeBtn.classList.add('active');

  renderReports(period);
}

function renderReports(period) {
  const listContainer = document.getElementById('pwa-reports-list-container');
  const totalEarnedEl = document.getElementById('reports-total-earned');
  const totalCountEl = document.getElementById('reports-total-count');

  if (!listContainer) return;

  // Filter deliveries based on date period
  const filtered = riderHistory.filter(order => {
    const orderDate = parseOrderDate(order.date);
    if (period === 'day') return isDateToday(orderDate);
    if (period === 'week') return isDateInCurrentWeek(orderDate);
    if (period === 'month') return isDateInCurrentMonth(orderDate);
    return false;
  });

  // Calculate totals
  let totalEarned = 0;
  filtered.forEach(order => {
    totalEarned += parseMoney(order.price);
  });

  if (totalEarnedEl) totalEarnedEl.innerText = formatMoney(totalEarned);
  if (totalCountEl) totalCountEl.innerText = filtered.length;

  // Render items
  if (filtered.length === 0) {
    listContainer.innerHTML = '<p class="pwa-empty-msg" style="text-align:center; color:var(--muted); margin: 30px 0; font-size:0.85rem;">Nenhuma tele entregue neste período.</p>';
    return;
  }

  listContainer.innerHTML = filtered.map(order => `
    <div class="pwa-report-item">
      <div>
        <strong style="font-family: var(--font-display); font-size: 0.9rem; color: var(--text);">${order.id}</strong>
        <p style="font-size: 0.78rem; color: var(--muted); margin-top: 2px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 170px;">${order.address}</p>
        <span style="font-size: 0.72rem; color: var(--muted); display: block; margin-top: 4px;">${order.date}</span>
      </div>
      <div style="text-align: right;">
        <strong style="font-size: 0.95rem; color: #10b981;">${order.price}</strong>
        <span style="font-size: 0.7rem; color: var(--success); font-weight: 700; display: block; text-transform: uppercase; margin-top: 2px;">Entregue</span>
      </div>
    </div>
  `).join('');
}

// ─── PWA INSTALLATION HANDLER ────────────────────────────────────────────────

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  
  // Show install buttons
  const loginInstallBtn = document.getElementById('pwa-install-app-btn');
  const drawerInstallBtn = document.getElementById('pwa-nav-install');
  
  if (loginInstallBtn) loginInstallBtn.classList.remove('hidden');
  if (drawerInstallBtn) drawerInstallBtn.classList.remove('hidden');
});

function triggerAppInstall() {
  if (!deferredPrompt) {
    alert('O atalho já foi instalado ou não é suportado pelo seu navegador atual. Se estiver usando iPhone/Safari, toque no botão de compartilhar e selecione "Adicionar à Tela de Início".');
    return;
  }
  
  // Show the prompt
  deferredPrompt.prompt();
  
  // Wait for the user to respond to the prompt
  deferredPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === 'accepted') {
      showPWAToast('Obrigado por instalar o aplicativo!');
    }
    deferredPrompt = null;
    
    // Hide install buttons
    const loginInstallBtn = document.getElementById('pwa-install-app-btn');
    const drawerInstallBtn = document.getElementById('pwa-nav-install');
    
    if (loginInstallBtn) loginInstallBtn.classList.add('hidden');
    if (drawerInstallBtn) drawerInstallBtn.classList.add('hidden');
  });
}

// Listen for successful installation
window.addEventListener('appinstalled', () => {
  showPWAToast('Aplicativo Garra instalado com sucesso!');
  deferredPrompt = null;
  
  const loginInstallBtn = document.getElementById('pwa-install-app-btn');
  const drawerInstallBtn = document.getElementById('pwa-nav-install');
  
  if (loginInstallBtn) loginInstallBtn.classList.add('hidden');
  if (drawerInstallBtn) drawerInstallBtn.classList.add('hidden');
});

// ─── NEW SYSTEM TELES & MATCHMAKING SUPPORT ────────────────────────────────────

async function loadSystemTeles() {
  const container = document.getElementById('pwa-system-teles-container');
  if (!container) return;

  container.innerHTML = `
    <div class="pwa-loading">
      <div class="pwa-spinner"></div>
      <p>Carregando teles do sistema...</p>
    </div>
  `;

  if (!db) return;

  try {
    const { data, error } = await db
      .from('pending_deliveries')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    renderSystemTelesList(data || []);
  } catch (err) {
    console.error("Error loading system teles:", err);
    container.innerHTML = `<p class="pwa-empty-msg">Erro ao carregar teles do sistema.</p>`;
  }
}

function renderSystemTelesList(teles) {
  const container = document.getElementById('pwa-system-teles-container');
  if (!container) return;

  if (teles.length === 0) {
    container.innerHTML = `
      <div class="pwa-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <p>Nenhuma tele pendente no sistema.</p>
        <span>Aguarde novas chamadas dos comércios.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  teles.forEach(order => {
    const card = document.createElement('div');
    card.className = 'pwa-tele-card';
    card.innerHTML = `
      <div class="pwa-tele-header">
        <strong class="pwa-tele-id">${order.id}</strong>
        <span class="pwa-tele-status status-warning" style="background: rgba(245,158,11,0.15); color: #f59e0b; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600;">Pendente</span>
      </div>
      <div class="pwa-tele-body">
        <div class="pwa-tele-row" style="margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          <strong style="color: var(--primary); font-size: 0.88rem;">Origem: ${order.client}</strong>
        </div>
        <div class="pwa-tele-row" style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>Destino: ${order.address}</span>
        </div>
        <div class="pwa-tele-row pwa-tele-meta" style="margin-top: 8px; display: flex; justify-content: space-between;">
          <span>Distância: <strong>${order.dist}</strong></span>
          <span>Taxa: <strong class="pwa-highlight" style="color: var(--primary);">${order.price}</strong></span>
        </div>
        <div class="pwa-tele-row pwa-tele-meta" style="margin-top: 4px; font-size: 0.78rem; color: var(--text-muted);">
          <span>Pagamento: <strong>${order.payment}</strong></span>
        </div>
      </div>
      <div class="pwa-tele-footer" style="margin-top: 12px; display: flex; gap: 8px;">
        <button class="pwa-btn pwa-btn-primary" onclick="showPendingTeleModalById('${order.id}')" style="flex: 1; padding: 10px; background: var(--primary); color: white; border: none; border-radius: var(--radius); cursor: pointer; font-weight: 600;">
          Visualizar & Aceitar
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

async function showPendingTeleModalById(teleId) {
  if (!db) return;
  try {
    const { data, error } = await db
      .from('pending_deliveries')
      .select('*')
      .eq('id', teleId)
      .single();

    if (error || !data) {
      showPWAToast("Tele não está mais disponível.");
      loadSystemTeles();
      return;
    }

    showPendingTeleModal(data);
  } catch (err) {
    console.error("Error loading tele details:", err);
  }
}

async function updateSystemTelesCount() {
  if (!db) return;
  try {
    const { count, error } = await db
      .from('pending_deliveries')
      .select('*', { count: 'exact', head: true });
    
    if (!error) {
      const badge = document.getElementById('map-system-teles-badge');
      if (badge) {
        if (count > 0) {
          badge.innerText = count;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
    }
  } catch (err) {
    console.error("Error updating system teles count:", err);
  }
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
